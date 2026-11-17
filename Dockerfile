FROM node:22-alpine

WORKDIR /app
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

# Runs as the image's unprivileged "node" user (uid/gid 1000). The data folder must be writable by it.
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.js"]
