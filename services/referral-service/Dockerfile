FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

COPY prisma ./prisma
COPY shared ./shared
COPY services/referral-service/package*.json ./services/referral-service/


RUN npm install
WORKDIR /app/services/referral-service
COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms"
RUN npx prisma@6 generate --schema=./prisma/schema.prisma


COPY services/referral-service/src ./src

EXPOSE 3005

CMD ["node", "src/server.js"]
