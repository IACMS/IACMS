FROM node:20-alpine

WORKDIR /app

COPY services/workflow-service/package*.json ./
RUN npm ci

COPY services/workflow-service/prisma ./prisma
RUN npx prisma generate

COPY services/workflow-service/src ./src
COPY shared ./shared

EXPOSE 3004

CMD ["node", "src/server.js"]

