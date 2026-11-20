# Build context: repo root. Railway: RAILWAY_DOCKERFILE_PATH=apps/worker/Dockerfile. Browser version must match the playwright npm version.
FROM mcr.microsoft.com/playwright:v1.65.1-noble
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --filter worker... --no-frozen-lockfile
COPY packages/core packages/core
COPY apps/worker apps/worker
COPY db db
ENV NODE_ENV=production DATA_DIR=/data
# Apply the schema, then start the worker.
CMD ["sh", "-c", "pnpm --filter worker migrate && pnpm --filter worker start"]
