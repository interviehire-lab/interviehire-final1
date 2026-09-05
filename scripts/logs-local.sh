#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

TAIL_LINES="${TAIL_LINES:-200}"

# Re-running this in a new terminal tab without stopping the previous one is
# an easy mistake (it happened) — a leaked instance's tail -F followers keep
# reading the same log files forever, silently multiplying every line you see
# with no indication anything is wrong. Stop any previous instance first:
# killing its PID sends TERM, which fires *its own* cleanup trap below,
# cleanly killing its followers via the exact same mechanism this instance
# uses on exit — not a separate ad-hoc process hunt.
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

if [ "$#" -gt 0 ]; then
  services=("$@")
else
  services=(interview-api voice-agent fastapi-backend candidate-web dashboard)
fi

color_for_service() {
  case "$1" in
    interview-api) printf '\033[1;36m' ;;
    voice-agent) printf '\033[1;33m' ;;
    fastapi-backend) printf '\033[1;35m' ;;
    candidate-web) printf '\033[1;32m' ;;
    dashboard) printf '\033[1;34m' ;;
    *) printf '\033[1;33m' ;;
  esac
}

followers=()
# Each follower is `( tail -F | while read ... ) &` — a whole pipeline, not a
# single process. Killing just its own PID only stops the subshell wrapper;
# bash gives that pipeline its own process group (pgid == the subshell's
# pid), and `tail`/`while read` are separate processes in it that survive a
# plain `kill` as orphans (reparented to PID 1) — confirmed live: this is
# exactly how the leaked processes across this session accumulated. Kill the
# whole group with the negative pgid instead.
kill_follower() {
  local pid="$1" pgid
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -n "$pgid" ]; then
    kill -- "-$pgid" 2>/dev/null || true
  fi
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  local pid
  for pid in "${followers[@]}"; do
    kill_follower "$pid"
  done
  # Only remove the lock if it's still ours — a newer instance may have
  # already stopped us and written its own PID in before this trap ran.
  if [ -f "$VIEWER_LOCK_FILE" ] && [ "$(cat "$VIEWER_LOCK_FILE" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$VIEWER_LOCK_FILE"
  fi
}
trap cleanup EXIT INT TERM

for service in "${services[@]}"; do
  log_file="$LOG_DIR/$service.log"
  if [ ! -f "$log_file" ]; then
    warn "Skipping $service: $log_file does not exist."
    continue
  fi

  color="$(color_for_service "$service")"
  (
    tail -n "$TAIL_LINES" -F "$log_file" 2>/dev/null |
      while IFS= read -r line; do
        printf '%b[%s]%b %s\n' "$color" "$service" '\033[0m' "$line"
      done
  ) &
  followers+=("$!")
done

if [ "${#followers[@]}" -eq 0 ]; then
  fail "No local service logs were found in $LOG_DIR. Run scripts/start-local.sh first."
fi

info "Following ${#followers[@]} local service log(s). Press Ctrl+C to stop."
wait
