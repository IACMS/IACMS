# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
COPY shared ./shared
COPY services/api-gateway/package*.json ./services/api-gateway/
COPY services/audit-service/package*.json ./services/audit-service/
COPY services/case-engine-service/package*.json ./services/case-engine-service/
COPY services/file-service/package*.json ./services/file-service/
COPY services/iam-service/package*.json ./services/iam-service/
COPY services/integration-service/package*.json ./services/integration-service/
COPY services/notification-service/package*.json ./services/notification-service/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 --fetch-retries=5

RUN npm prune --omit=dev

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared ./shared
COPY --from=deps /app/package.json ./package.json
COPY services/notification-service/package.json ./services/notification-service/package.json
COPY services/notification-service/src ./services/notification-service/src

WORKDIR /app/services/notification-service
EXPOSE 3008
CMD ["node", "src/server.js"]
