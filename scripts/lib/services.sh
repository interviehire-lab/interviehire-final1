#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/compose.yml"
RUNTIME_DIR="$REPO_ROOT/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
success() { printf '\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' was not found."
}

load_env_file() {
  local env_file="$1"
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

compose() {
  docker compose -f "$COMPOSE_FILE" -p "${COMPOSE_PROJECT_NAME:-interviehire}" "$@"
}

wait_for_url() {
  local name="$1" url="$2" attempts="${3:-60}"
  local count=0
  until curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; do
    count=$((count + 1))
    if [ "$count" -ge "$attempts" ]; then
      return 1
    fi
    sleep 1
  done
  success "$name is ready at $url"
}

pid_is_running() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

assert_process_port_available() {
  local name="$1" port="$2" pid_file="$PID_DIR/$1.pid"
  if pid_is_running "$pid_file"; then
    return 0
  fi
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $port is already in use; cannot start $name. Stop the existing service or override its port."
  fi
}

start_process() {
  local name="$1" workdir="$2"
  shift 2
  local pid_file="$PID_DIR/$name.pid" log_file="$LOG_DIR/$name.log"

  if pid_is_running "$pid_file"; then
    warn "$name is already running (PID $(cat "$pid_file"))."
    return 0
  fi

  rm -f "$pid_file"
  (
    cd "$workdir"
    nohup "$@" >"$log_file" 2>&1 &
    printf '%s\n' "$!" >"$pid_file"
  )
  info "Started $name (log: $log_file)."
}

stop_process_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_process_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

stop_process() {
  local name="$1" pid_file="$PID_DIR/$1.pid"
  if ! pid_is_running "$pid_file"; then
    rm -f "$pid_file"
    warn "$name is not running under the local service manager."
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  stop_process_tree "$pid"
  local count=0
  while kill -0 "$pid" 2>/dev/null && [ "$count" -lt 20 ]; do
    sleep 0.25
    count=$((count + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
  success "Stopped $name."
}
