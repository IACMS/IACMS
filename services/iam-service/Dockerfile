FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/iam-service/package*.json ./services/iam-service/

RUN npm install
WORKDIR /app/services/iam-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/iam-service/src ./src

EXPOSE 3001

CMD ["node", "src/server.js"]
