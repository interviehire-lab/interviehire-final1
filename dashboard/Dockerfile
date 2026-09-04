# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

ARG NPM_VERSION=11.16.0
RUN npm install --global "npm@${NPM_VERSION}" --no-audit --no-fund

COPY package*.json ./
RUN --mount=type=cache,id=interviehire-dashboard-npm-v2,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --prefer-offline

COPY . .

ARG NEXT_PUBLIC_API_URL=/api
ARG BACKEND_ORIGIN=http://backend:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    BACKEND_ORIGIN=${BACKEND_ORIGIN} \
    NODE_ENV=production \
    PORT=3000

RUN npm run build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["npm", "run", "start"]
