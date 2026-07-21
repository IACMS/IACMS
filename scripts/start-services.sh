#!/usr/bin/env bash
# Start (or restart) IACMS microservices with logs to files — avoids TTY backpressure hangs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="${IACMS_LOG_DIR:-/tmp/iacms-logs}"
mkdir -p "$LOGDIR"

SERVICES=(
  "api-gateway:3000"
  "auth-service:3001"
  "rbac-service:3002"
  "case-service:3003"
  "workflow-service:3004"
  "referral-service:3005"
  "audit-service:3006"
  "integration-service:3007"
  "notification-service:3008"
  "file-service:3009"
)

pid_on_port() {
  local port=$1
  ss -tlnp 2>/dev/null | awk -v p=":$port " '
    $0 ~ p {
      if (match($0, /pid=[0-9]+/)) {
        print substr($0, RSTART + 4, RLENGTH - 4)
        exit
      }
    }'
}

start_one() {
  local name=$1 port=$2
  local existing
  existing="$(pid_on_port "$port" || true)"
  if [[ -n "$existing" ]]; then
    echo "stopping $name (pid $existing) on :$port"
    kill "$existing" 2>/dev/null || true
    sleep 1
    if kill -0 "$existing" 2>/dev/null; then
      kill -9 "$existing" 2>/dev/null || true
      sleep 1
    fi
  fi
  (
    cd "$ROOT/services/$name"
    nohup node src/server.js >>"$LOGDIR/$name.log" 2>&1 &
    echo $! >"$LOGDIR/$name.pid"
  )
  echo "started $name pid=$(cat "$LOGDIR/$name.pid") → $LOGDIR/$name.log"
}

for entry in "${SERVICES[@]}"; do
  start_one "${entry%%:*}" "${entry##*:}"
done

sleep 3
echo
echo "Health:"
for entry in "${SERVICES[@]}"; do
  port="${entry##*:}"
  code="$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health" 2>/dev/null || echo down)"
  printf "  :%s %s\n" "$port" "$code"
done
