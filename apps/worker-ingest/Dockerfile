# Build from monorepo root: docker build -f apps/worker-ingest/Dockerfile .
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker-ingest ./apps/worker-ingest
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@vahan360/worker-ingest...
ENV NODE_ENV=production
WORKDIR /repo/apps/worker-ingest
CMD ["node", "src/index.js"]
