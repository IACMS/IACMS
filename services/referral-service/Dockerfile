FROM node:20-alpine

WORKDIR /app

COPY services/referral-service/package*.json ./
RUN npm ci

COPY services/referral-service/prisma ./prisma
RUN npx prisma generate

COPY services/referral-service/src ./src
COPY shared ./shared

EXPOSE 3005

CMD ["node", "src/server.js"]

