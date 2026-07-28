FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
COPY shared ./shared
COPY services/audit-service/package*.json ./services/audit-service/

RUN npm install
WORKDIR /app/services/audit-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/audit-service/src ./src

EXPOSE 3006

CMD ["node", "src/server.js"]
