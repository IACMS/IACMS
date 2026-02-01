FROM node:20-alpine

WORKDIR /app

COPY services/auth-service/package*.json ./
RUN npm ci

COPY services/auth-service/prisma ./prisma
RUN npx prisma generate

COPY services/auth-service/src ./src
COPY shared ./shared

EXPOSE 3001

CMD ["node", "src/server.js"]
