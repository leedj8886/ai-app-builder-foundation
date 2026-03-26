FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/server/package*.json ./apps/server/

# Install dependencies
RUN npm ci

# Copy source code
COPY apps/server ./apps/server

# Build
WORKDIR /app/apps/server
RUN npm run build

# Expose port
EXPOSE 3001

# Start
CMD ["npm", "start"]
