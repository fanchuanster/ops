# NobleSee web — Next.js 16 + Payload 3 + PostgreSQL.
#
# Multi-stage so the runtime image carries only what the server needs:
# Next's standalone output traces the actual dependency graph instead of
# shipping the whole node_modules tree.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build must not need a database: the catalog page is force-dynamic
# precisely so `next build` never opens a connection. These values are
# placeholders that are overridden at runtime.
ENV DATABASE_URI=postgres://build:build@127.0.0.1:5432/build \
    PAYLOAD_SECRET=build-time-placeholder
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root. Nothing here writes outside /app.
RUN useradd --create-home --uid 10001 noblesee

COPY --from=builder --chown=noblesee:noblesee /app/.next/standalone ./
COPY --from=builder --chown=noblesee:noblesee /app/.next/static ./.next/static
COPY --from=builder --chown=noblesee:noblesee /app/public ./public

USER noblesee
EXPOSE 3000

CMD ["node", "server.js"]
