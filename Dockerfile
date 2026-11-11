FROM node:22-bookworm-slim AS base

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm install --global npm@11.6.2 \
    && npm ci --no-audit --foreground-scripts --fetch-timeout=60000 --fetch-retries=1

FROM dependencies AS migrations

ENV NODE_ENV=production
COPY scripts/verify-production-config.mjs ./scripts/verify-production-config.mjs
COPY scripts/lib/production-config.mjs ./scripts/lib/production-config.mjs
COPY scripts/lib/private-photo-rescan-config.mjs ./scripts/lib/private-photo-rescan-config.mjs
USER node
CMD ["/bin/sh", "-c", "node scripts/verify-production-config.mjs && exec ./node_modules/.bin/prisma migrate deploy"]

FROM base AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/verify-production-config.mjs ./scripts/verify-production-config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/lib/production-config.mjs ./scripts/lib/production-config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/lib/private-photo-rescan-config.mjs ./scripts/lib/private-photo-rescan-config.mjs

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["/bin/sh", "-c", "node scripts/verify-production-config.mjs && exec node server.js"]
