#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command node

TAIL_LINES="${TAIL_LINES:-200}"

if [ "$#" -gt 0 ]; then
  services=("$@")
else
  services=(interview-api voice-agent fastapi-backend candidate-web dashboard)
fi

# Re-running this in a new terminal tab without stopping the previous one is
# an easy mistake — stop any previous instance first so only one viewer is
# ever reading the log files.
VIEWER_LOCK_FILE="$PID_DIR/logs-local-viewer.pid"
if [ -f "$VIEWER_LOCK_FILE" ]; then
  old_pid="$(cat "$VIEWER_LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && [ "$old_pid" != "$$" ] && kill -0 "$old_pid" 2>/dev/null; then
    warn "Stopping a log viewer already running (PID $old_pid) before starting this one."
    kill "$old_pid" 2>/dev/null || true
    sleep 0.5
  fi
fi
printf '%s\n' "$$" >"$VIEWER_LOCK_FILE"
trap 'rm -f "$VIEWER_LOCK_FILE" 2>/dev/null || true' EXIT

# The actual tailing/parsing/formatting lives in one Node process now (see
# lib/log-viewer.mjs) instead of one `tail -F | while read` pipeline per
# service — simpler, and there's nothing left to leak: no per-service
# subshells or process groups for a stray Ctrl+C to fail to fully clean up.
# Deliberately not `exec`'d: this script needs to regain control after node
# exits so the EXIT trap above actually runs and removes the lock file.
node "$SCRIPT_DIR/lib/log-viewer.mjs" --dir "$LOG_DIR" --lines "$TAIL_LINES" "${services[@]}"
