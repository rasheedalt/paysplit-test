FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json tsconfig.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN npm run build

FROM build AS migrate
RUN mkdir /data && chown node:node /data
ENV DATABASE_URL=file:/data/paysplit.db
VOLUME /data
USER node
CMD ["node", "dist/scripts/prepareDatabase.js"]

FROM node:24-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY openapi.json ./openapi.json
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=8000 PAYSPLIT_EMBEDDED_WORKER=1 DATABASE_URL=file:/data/paysplit.db
VOLUME /data
USER node
EXPOSE 8000
CMD ["npm", "start"]
