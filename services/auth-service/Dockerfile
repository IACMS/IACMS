FROM node:20-alpine

WORKDIR /app

COPY prisma ./prisma
COPY shared ./shared
COPY services/auth-service/package*.json ./services/auth-service/

WORKDIR /app/services/auth-service
RUN npm ci
RUN npx prisma generate --schema=../../prisma/schema.prisma

COPY services/auth-service/src ./src

EXPOSE 3001

CMD ["node", "src/server.js"]
