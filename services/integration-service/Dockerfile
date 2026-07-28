FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
COPY shared ./shared
COPY services/integration-service/package*.json ./services/integration-service/

RUN npm install
WORKDIR /app/services/integration-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/integration-service/src ./src

EXPOSE 3007

CMD ["node", "src/server.js"]
