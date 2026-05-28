FROM node:20-alpine

WORKDIR /app

COPY services/case-service/package*.json ./
RUN npm ci

COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms"
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY services/case-service/src ./src
COPY shared ./shared

EXPOSE 3003

CMD ["node", "src/server.js"]
