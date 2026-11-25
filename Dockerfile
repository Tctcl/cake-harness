# syntax=docker/dockerfile:1

# The product image for one install: Fastify serving the built SPA from the same origin, so there is no CORS config and
# no second web server to keep in step with the route table.
#
# The build context is the repository root, because the frontend and the shared TypeScript presets are part of what
# gets compiled. `docker build -f Dockerfile .` from the root; see docs/deployment.md for the channels.

FROM node:26-bookworm-slim AS build

RUN npm install --global pnpm@12.16.1

WORKDIR /repo

# Manifests first: a source edit then rebuilds from `pnpm install` onwards instead of re-resolving dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/oxlint-config/package.json packages/oxlint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/vitest-config/package.json packages/vitest-config/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter backend build \
 && pnpm --filter frontend build \
 # `deploy` answers the runtime's node_modules without pnpm or the workspace on the image. The backend depends on no
 # other workspace package, so `--prod` is the whole runtime dependency set.
 && pnpm --filter backend deploy --prod /out

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    FRONTEND_DIR=/app/public

WORKDIR /app

COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/frontend/dist ./public

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
