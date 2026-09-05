# syntax=docker/dockerfile:1
FROM node:22-slim AS build

WORKDIR /app
RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY package.json ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --no-frozen-lockfile
RUN pnpm exec livekit-agents download-files

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:22-slim AS runtime

RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

USER app
EXPOSE 8081
CMD ["node", "dist/agent.js", "start"]
