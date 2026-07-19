# syntax=docker/dockerfile:1

# ---------- deps: install dependencies ----------
# better-sqlite3 compiles from source on Alpine (musl), hence the build tools.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
# postinstall runs `prisma generate`, which needs the schema + config
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
ENV DATABASE_URL="file:./dev.db"
RUN npm ci

# ---------- builder: generate the Prisma client and compile the app ----------
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:./dev.db"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Bundle the demo seed (seed.cjs) so the slim runtime image can run it
# without tsx or devDependencies; native/runtime packages stay external and
# resolve from the standalone server's node_modules.
RUN npx prisma generate \
 && npm run build \
 && npx esbuild prisma/seed.ts --bundle --platform=node --format=cjs \
      --outfile=seed.cjs \
      --define:import.meta.url=__importMetaUrl \
      --banner:js="const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" \
      --external:better-sqlite3 \
      --external:@libsql/client --external:@prisma/client

# ---------- runner: minimal standalone server ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="file:/data/nexus.db"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma/migrations ./prisma/migrations
COPY --from=builder /app/seed.cjs ./scripts/seed.cjs
COPY scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs

# The SQLite database lives on a mounted volume; run as the unprivileged user.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

ENTRYPOINT ["node", "scripts/docker-entrypoint.mjs"]
