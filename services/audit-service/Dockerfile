FROM node:20-alpine

WORKDIR /app

COPY services/audit-service/package*.json ./
RUN npm ci

COPY services/audit-service/prisma ./prisma
RUN npx prisma generate

COPY services/audit-service/src ./src
COPY shared ./shared

EXPOSE 3006

CMD ["node", "src/server.js"]

