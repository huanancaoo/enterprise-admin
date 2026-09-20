FROM node:26.8.2-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter docs build

FROM node:26.8.2-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3300
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder --chown=nextjs:nextjs /app/apps/docs/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/docs/.next/static ./apps/docs/.next/static
USER nextjs
EXPOSE 3300
CMD ["node", "apps/docs/server.js"]
