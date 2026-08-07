FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/case-engine-service/package*.json ./services/case-engine-service/

RUN npm install
WORKDIR /app/services/case-engine-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/case-engine-service/src ./src

EXPOSE 3003

CMD ["node", "src/server.js"]
