FROM node:20-alpine

WORKDIR /app

COPY services/integration-service/package*.json ./
RUN npm ci

COPY services/integration-service/prisma ./prisma
RUN npx prisma generate

COPY services/integration-service/src ./src
COPY shared ./shared

EXPOSE 3007

CMD ["node", "src/server.js"]

