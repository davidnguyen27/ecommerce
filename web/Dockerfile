# Build từ gốc repo: docker build -f web/Dockerfile .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile --filter @ecommerce/web... --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY web web
WORKDIR /repo/web
RUN pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /repo/web/.output .output
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
