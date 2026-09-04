# syntax=docker/dockerfile:1

# Railway builds the final stage when no explicit Docker target is configured.
# Set RUNTIME_TARGET=api or RUNTIME_TARGET=web on each Railway service.
ARG RUNTIME_TARGET=api

# Both the Fastify API and candidate web app use the same npm workspace. Keeping
# dependency installation in one common stage lets BuildKit execute it once and
# reuse it for both final targets.
FROM node:22-alpine AS dependencies
WORKDIR /app

# npm 10.9.8 (bundled in the current Node 22 Alpine image) intermittently exits
# with "Exit handler never called" while resolving this workspace lockfile.
# Match the npm major used successfully by local development.
ARG NPM_VERSION=11.16.0
RUN npm install --global "npm@${NPM_VERSION}" --no-audit --no-fund

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --no-audit --no-fund --prefer-offline

FROM dependencies AS source
COPY . .
RUN npm run build -w packages/shared

FROM source AS api
RUN npm run build -w apps/api

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-4000}/health" >/dev/null || exit 1

CMD ["npm", "run", "start", "-w", "apps/api"]

FROM source AS web

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NODE_ENV=production

RUN npm run build -w apps/web

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/" >/dev/null || exit 1

CMD ["npm", "run", "start", "-w", "apps/web"]

# Give Dockerfile-based platforms a deterministic final image while retaining
# the named api/web targets used by Docker Compose.
FROM ${RUNTIME_TARGET} AS runtime
