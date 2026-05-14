# Build from monorepo root: docker build -f apps/api-nest/Dockerfile .
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api-nest ./apps/api-nest
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@vahan360/api-nest...
ENV NODE_ENV=production
WORKDIR /repo/apps/api-nest
CMD ["node", "dist/main.js"]
