# syntax=docker/dockerfile:1.7
FROM node:22.19-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/

# Install dependencies with a persistent package cache and bounded registry retries.
RUN --mount=type=cache,target=/root/.npm \
    npm ci \
      --prefer-offline \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=120000 \
    && npm install --no-save \
      --prefer-offline \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=120000 \
      "@rollup/rollup-linux-$(node -p 'process.arch')-musl@4.60.0"

# Copy source code
COPY apps/web ./apps/web

# Build
WORKDIR /app/apps/web
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
