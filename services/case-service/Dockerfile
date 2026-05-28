FROM node:20-alpine

WORKDIR /app

COPY prisma ./prisma
COPY shared ./shared
COPY services/case-service/package*.json ./services/case-service/

COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms"
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY services/case-service/src ./src

EXPOSE 3003

CMD ["node", "src/server.js"]
