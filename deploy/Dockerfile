FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV MATHREALMS_DB=/app/data/mathrealms.sqlite

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p /app/data

EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "server/index.ts"]
