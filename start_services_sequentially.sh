#!/bin/bash

# A script to start Docker Compose services sequentially to avoid out-of-memory or system crashes.
# It uses the desktop context (default for Docker Desktop).

COMPOSE_FILE="infrastructure/docker-compose.yml"

echo "Starting down all containers (just in case)..."
docker compose --env-file infrastructure/.env --env-file .env -f $COMPOSE_FILE down

# Ordered list of services. Backing services first, then core services, then API.
SERVICES=(
  "postgres"
  "redis"
  "zookeeper"
  "kafka"
  "minio"
  "minio-init"
  "clamav"
  "file-service"
  "file-service-workers"
  "integration-service"
  "notification-service"
  "iam-service"
  "audit-service"
  "case-engine-service"
  "api-gateway"
)

echo "Starting services sequentially..."

for service in "${SERVICES[@]}"; do
  echo "-------------------------------"
  echo "🚀 Starting $service..."
  docker compose --env-file infrastructure/.env --env-file .env -f $COMPOSE_FILE up -d "$service"
  
  if [ $? -ne 0 ]; then
    echo "❌ Failed to start $service. Aborting script."
    exit 1
  fi
  
  echo "✅ $service started. Waiting 5 seconds before next..."
  sleep 5
done

echo "🎉 All services have been instructed to start!"
