FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/file-service/package*.json ./services/file-service/

RUN npm install
WORKDIR /app/services/file-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

# ── HTTP service image ────────────────────────────────────────────────────────
FROM node:22-alpine AS http

WORKDIR /app
COPY package*.json ./
COPY --from=deps /app /app
COPY services/file-service/src ./services/file-service/src

RUN npm install
WORKDIR /app/services/file-service
EXPOSE 3009
CMD ["node", "src/server.js"]

# ── Workers image (ffmpeg for video compression) ──────────────────────────────
FROM node:22-bookworm-slim AS workers

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY --from=deps /app /app
COPY services/file-service/src ./services/file-service/src

RUN npm install
WORKDIR /app/services/file-service
ENV WORKER_MODE=standalone
CMD ["node", "src/workers/standalone.js"]
