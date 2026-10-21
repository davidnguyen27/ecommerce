# Build từ gốc repo: docker build -f api/Dockerfile .
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile --filter @ecommerce/api...

COPY tsconfig.base.json ./
COPY shared shared
COPY api api
WORKDIR /repo/api
RUN pnpm build

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "dist/server.js"]
