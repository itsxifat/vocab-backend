FROM node:20-alpine AS admin-builder

WORKDIR /admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build          # outputs to ../public (mapped to /public below)

# ── Backend ───────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
# Replace the (possibly stale) committed build with the freshly compiled one
COPY --from=admin-builder /public ./public

EXPOSE 3000
CMD ["node", "server.js"]
