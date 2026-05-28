FROM node:20-alpine

WORKDIR /app

COPY prisma ./prisma
COPY shared ./shared
COPY services/workflow-service/package*.json ./services/workflow-service/


WORKDIR /app/services/workflow-service
RUN npm ci
COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iacms"
RUN npx prisma generate --schema=./prisma/schema.prisma


COPY services/workflow-service/src ./src

EXPOSE 3004

CMD ["node", "src/server.js"]
