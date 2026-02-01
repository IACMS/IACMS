FROM node:20-alpine

WORKDIR /app

COPY services/rbac-service/package*.json ./
RUN npm ci

COPY services/rbac-service/prisma ./prisma
RUN npx prisma generate

COPY services/rbac-service/src ./src
COPY shared ./shared

EXPOSE 3002

CMD ["node", "src/server.js"]
