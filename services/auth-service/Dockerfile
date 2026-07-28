FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/auth-service/package*.json ./services/auth-service/

RUN npm install
WORKDIR /app/services/auth-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/auth-service/src ./src

EXPOSE 3001

CMD ["node", "src/server.js"]
