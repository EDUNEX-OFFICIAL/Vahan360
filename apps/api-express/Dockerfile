# Build from monorepo root: docker build -f apps/api-express/Dockerfile .
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

ENV NODE_ENV=production

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps/api-express ./apps/api-express
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vahan360/api-express prisma:generate   && pnpm turbo run build --filter=@vahan360/api-express

WORKDIR /repo/apps/api-express
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3   CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"
CMD ["node", "src/app.js"]
