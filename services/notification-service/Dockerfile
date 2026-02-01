FROM node:20-alpine

WORKDIR /app

COPY services/notification-service/package*.json ./
RUN npm ci

COPY services/notification-service/src ./src
COPY shared ./shared

EXPOSE 3008

CMD ["node", "src/server.js"]

