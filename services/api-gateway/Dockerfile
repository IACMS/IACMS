FROM node:20-alpine

WORKDIR /app

COPY services/api-gateway/package*.json ./
RUN npm ci

COPY services/api-gateway/src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
