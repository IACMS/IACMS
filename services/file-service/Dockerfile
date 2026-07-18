FROM node:22-alpine

WORKDIR /app

COPY prisma ./prisma
COPY shared ./shared
COPY services/file-service/package*.json ./services/file-service/

WORKDIR /app/services/file-service
RUN npm ci
RUN npx prisma generate --schema=../../prisma/schema.prisma

COPY services/file-service/src ./src

EXPOSE 3009

CMD ["node", "src/server.js"]
