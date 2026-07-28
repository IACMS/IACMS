FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/case-service/package*.json ./services/case-service/
COPY prisma/schema.prisma ./prisma/schema.prisma

RUN npm install
WORKDIR /app/services/case-service

RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/case-service/src ./src

EXPOSE 3003

CMD ["node", "src/server.js"]
