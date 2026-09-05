#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

TAIL_LINES="${TAIL_LINES:-200}"

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
cleanup() {
  if [ "${#followers[@]}" -gt 0 ]; then
    kill "${followers[@]}" 2>/dev/null || true
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
