FROM node:20-alpine

WORKDIR /app

COPY services/case-service/package*.json ./
RUN npm ci

COPY services/case-service/prisma ./prisma
RUN npx prisma generate

COPY services/case-service/src ./src
COPY shared ./shared

EXPOSE 3003

CMD ["node", "src/server.js"]
