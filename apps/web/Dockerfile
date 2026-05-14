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
# Standalone bundles native deps (e.g. sharp, SWC); musl runner needs glibc compat or Node can exit before bind :3000.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache libc6-compat
# Monorepo standalone: traced root is .next/standalone with apps/web/server.js (not ./server.js here).
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
# TCP liveness only — HTTP probes can exceed Docker's short CMD timeout on first dynamic request.
HEALTHCHECK --interval=10s --timeout=15s --start-period=120s --retries=10 \
  CMD node -e "const t=setTimeout(()=>process.exit(1),12000);const s=require('net').connect(3000,'127.0.0.1');s.on('connect',()=>{clearTimeout(t);s.end();process.exit(0)});s.on('error',()=>{clearTimeout(t);process.exit(1)});"
CMD ["node", "apps/web/server.js"]
