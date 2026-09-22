FROM node:22-bookworm-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json prisma ./
COPY apps ./apps
COPY packages ./packages
COPY contracts ./contracts
COPY scripts ./scripts
COPY deployments ./deployments

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build

ENV NODE_ENV=production
CMD ["node", "apps/api/dist/main.js"]
