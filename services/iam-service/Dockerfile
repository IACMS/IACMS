# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-retries=5

COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
# Prisma generation does not connect to a database, but its schema requires this variable.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run prisma:generate
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
EXPOSE 3001
CMD ["node", "src/server.js"]
