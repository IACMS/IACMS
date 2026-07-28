FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY shared ./shared
COPY services/notification-service/package*.json ./services/notification-service/

RUN npm install
WORKDIR /app/services/notification-service

COPY services/notification-service/src ./src

EXPOSE 3008

CMD ["node", "src/server.js"]
