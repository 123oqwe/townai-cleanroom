# syntax=docker/dockerfile:1
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/*/package.json packages/

# Install dependencies (frozen lockfile for reproducibility)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy all source and build
COPY . .
RUN pnpm build

# Production stage: only built dist + node_modules
FROM node:22-slim AS production
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./apps/api/dist
COPY --from=base /app/apps/api/package.json ./apps/api/package.json
COPY --from=base /app/apps/worker/dist ./apps/worker/dist
COPY --from=base /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=base /app/packages ./packages
COPY --from=base /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=base /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=base /app/package.json ./package.json

ENV NODE_ENV=production
ENV TOWN_PROCESS_ROLE=worker
CMD ["node", "apps/worker/dist/index.js"]
