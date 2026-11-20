# Web app on Railway. Build context: repo root. Set RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile.
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter web... --no-frozen-lockfile
COPY packages/core packages/core
COPY apps/web apps/web
COPY prompts prompts
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build
ENV NODE_ENV=production
# next start reads $PORT, which Railway sets.
CMD ["pnpm", "--filter", "web", "start"]
