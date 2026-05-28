FROM node:20-alpine

WORKDIR /app

COPY services/rbac-service/package*.json ./
RUN npm ci

COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms"
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY services/rbac-service/src ./src
COPY shared ./shared

EXPOSE 3002

CMD ["node", "src/server.js"]
