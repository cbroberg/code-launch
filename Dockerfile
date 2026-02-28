FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy server.ts + node_modules for the custom server (tsx handles TypeScript at runtime)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Data directory for SQLite (mounted as Fly volume at /data)
RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs

EXPOSE 8080

ENV DATABASE_URL=/data/sqlite.db
ENV HOSTNAME="0.0.0.0"

CMD ["node_modules/.bin/tsx", "server.ts"]
