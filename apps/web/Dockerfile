# Build from monorepo root: docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# Baked at build time. Leave empty for same-origin `/api/*` behind reverse proxy (docker-compose).
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm turbo run build --filter=@vahan360/web...

FROM node:20-alpine AS runner
WORKDIR /repo/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs   && adduser --system --uid 1001 nextjs
COPY --from=builder /repo/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./.next/static
USER nextjs
EXPOSE 3000
# Hit App Router `/health` (stable 200). Avoid probing `/` — it server-redirects to `/login`.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=8 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',(r)=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
