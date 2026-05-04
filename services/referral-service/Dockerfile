FROM node:20-alpine

WORKDIR /app

COPY prisma ./prisma
COPY shared ./shared
COPY services/referral-service/package*.json ./services/referral-service/

WORKDIR /app/services/referral-service
RUN npm ci
RUN npx prisma generate --schema=../../prisma/schema.prisma

COPY services/referral-service/src ./src

EXPOSE 3005

CMD ["node", "src/server.js"]
