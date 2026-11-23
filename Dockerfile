FROM node:24-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run build

FROM node:24-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY openapi.json ./openapi.json
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8000 PAYSPLIT_EMBEDDED_WORKER=1 PAYSPLIT_DB=/data/paysplit.db
VOLUME /data
USER node
EXPOSE 8000
CMD ["node", "dist/src/server.js"]
