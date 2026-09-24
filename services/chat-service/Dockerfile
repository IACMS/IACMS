# Base image
FROM node:20-alpine AS base
WORKDIR /app
# Enable corepack for modern package management if needed
RUN corepack enable

# Build stage
FROM base AS build
WORKDIR /app
COPY package*.json ./
# Clean install
RUN npm ci
# Copy source
COPY . .
# We would normally generate prisma here if not using a shared schema
# However, we rely on the monorepo's shared prisma client setup.

# Production image
FROM base AS production
WORKDIR /app

# Copy production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source files
COPY src/ ./src/
# Copy the shared directory if needed, typically mounted in docker-compose for dev
# In production, we need to ensure shared code is available. 
# We'll adjust based on how IACMS handles shared code across Docker containers.

ENV NODE_ENV=production
# Default port, overridden by docker-compose
ENV PORT=3009 

EXPOSE $PORT
CMD ["node", "src/server.js"]
