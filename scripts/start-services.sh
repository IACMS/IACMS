#!/usr/bin/env bash
# Start (or restart) IACMS microservices with logs to files — avoids TTY backpressure hangs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGDIR="${IACMS_LOG_DIR:-/tmp/iacms-logs}"
mkdir -p "$LOGDIR"

SERVICES=(
  "iam-service:3001"
  "case-engine-service:3003"
  "audit-service:3006"
  "integration-service:3007"
  "notification-service:3008"
  "file-service:3009"
  "api-gateway:3000"
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
    export PORT="$port"
    export DATABASE_URL="postgresql://postgres:postgres@localhost:5434/iacms?schema=public"
    export JWT_SECRET="change-this-secret-key-in-production-use-openssl-rand-base64-32"
    export REDIS_URL="redis://localhost:6379"
    export KAFKA_BROKERS="localhost:9092"
    export STORAGE_PROVIDER="minio"
    export MINIO_ENDPOINT="localhost"
    export MINIO_PORT="9000"
    export MINIO_ACCESS_KEY="minioadmin"
    export MINIO_SECRET_KEY="minioadmin"
    export MINIO_BUCKET="iacms-files"
    export MINIO_USE_SSL="false"
    export WORKER_MODE="embedded"
    export IAM_SERVICE_URL="http://localhost:3001"
    export AUTH_SERVICE_URL="http://localhost:3001"
    export RBAC_SERVICE_URL="http://localhost:3001"
    export CASE_ENGINE_SERVICE_URL="http://localhost:3003"
    export CASE_SERVICE_URL="http://localhost:3003"
    export WORKFLOW_SERVICE_URL="http://localhost:3003"
    export REFERRAL_SERVICE_URL="http://localhost:3003"
    export AUDIT_SERVICE_URL="http://localhost:3006"
    export INTEGRATION_SERVICE_URL="http://localhost:3007"
    export NOTIFICATION_SERVICE_URL="http://localhost:3008"
    export FILE_SERVICE_URL="http://localhost:3009"
    nohup node src/server.js </dev/null >>"$LOGDIR/$name.log" 2>&1 &
    local pid=$!
    disown $pid
    echo $pid >"$LOGDIR/$name.pid"
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
