FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
COPY shared ./shared
COPY services/rbac-service/package*.json ./services/rbac-service/

RUN npm install
WORKDIR /app/services/rbac-service
RUN npx prisma@6 generate --schema=../../prisma/schema.prisma

COPY services/rbac-service/src ./src

EXPOSE 3002

CMD ["node", "src/server.js"]
