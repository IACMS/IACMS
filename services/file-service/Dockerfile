# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
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

RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm prune --omit=dev

# ── HTTP service image ────────────────────────────────────────────────────────
FROM node:22-alpine AS http

WORKDIR /app
COPY --from=deps /app /app
COPY services/file-service/src ./services/file-service/src
COPY --from=deps /app/services/file-service/src/generated ./services/file-service/src/generated

WORKDIR /app/services/file-service
EXPOSE 3009
CMD ["node", "src/server.js"]

# ── Workers image (ffmpeg for video compression) ──────────────────────────────
FROM node:22-alpine AS workers

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY --from=deps /app /app
COPY services/file-service/src ./services/file-service/src
COPY --from=deps /app/services/file-service/src/generated ./services/file-service/src/generated

WORKDIR /app/services/file-service
ENV WORKER_MODE=standalone
CMD ["node", "src/workers/standalone.js"]
