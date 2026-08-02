# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/

# Install dependencies with a persistent package cache and bounded registry retries.
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
      --prefer-offline \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=120000

# Copy source code
COPY apps/server ./apps/server

# Build
WORKDIR /app/apps/server
RUN npm run build

# Expose port
EXPOSE 3001

# Start
CMD ["npm", "start"]
