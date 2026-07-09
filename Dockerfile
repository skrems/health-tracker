# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS app
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

LABEL org.opencontainers.image.title="Health Tracker"
LABEL org.opencontainers.image.description="Local health dashboard for bloodwork, DEXA, and Wyze scale data."
LABEL org.opencontainers.image.source="https://github.com/skrems/health-tracker"

ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/data/health-tracker.sqlite

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
