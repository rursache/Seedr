## Build stage - Backend
FROM node:22-alpine AS build-backend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

## Build stage - Frontend
FROM node:22-alpine AS build-ui
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ .
RUN npm run build

## Production stage
FROM node:22-alpine
WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled backend
COPY --from=build-backend /app/dist/ dist/

# Copy built frontend
COPY --from=build-ui /app/ui/dist/ ui/dist/

# Copy client profiles (project-level, used by first-run copy logic)
COPY clients/ clients/

# Data volume mount point — seed with client profiles so users start with defaults
RUN mkdir -p /data/clients /data/torrents
COPY clients/ /data/clients/
VOLUME /data

ENV NODE_ENV=production
ENV SEEDR_DATA_DIR=/data
ENV WEB_PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
