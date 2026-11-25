# syntax=docker/dockerfile:1

# Build from the repository root so pnpm can resolve the workspace and shared packages:
#   docker build -f apps/website/Dockerfile .
FROM node:26.13.1-bookworm-slim AS build

RUN npm install --global pnpm@12.16.1

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/website/package.json apps/website/
COPY packages/oxlint-config/package.json packages/oxlint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/vitest-config/package.json packages/vitest-config/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter website build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/website/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
