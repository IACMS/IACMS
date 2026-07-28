FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY shared ./shared
COPY services/api-gateway/package*.json ./services/api-gateway/

RUN npm install
WORKDIR /app/services/api-gateway

COPY services/api-gateway/src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
