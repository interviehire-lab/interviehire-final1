FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api.package.json
COPY packages/shared/package.json packages/shared/package.json
# Copy repository contents so workspace file: dependencies resolve during install
COPY . .

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4000/ws
ARG NEXT_PUBLIC_VAPI_PUBLIC_KEY=
ARG NEXT_PUBLIC_VAPI_ASSISTANT_ID=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
    NEXT_PUBLIC_VAPI_PUBLIC_KEY=${NEXT_PUBLIC_VAPI_PUBLIC_KEY} \
    NEXT_PUBLIC_VAPI_ASSISTANT_ID=${NEXT_PUBLIC_VAPI_ASSISTANT_ID} \
    NODE_ENV=production

RUN npm install
RUN npm run build -w packages/shared && npm run build -w apps/web
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/ >/dev/null || exit 1
CMD ["npm", "run", "start", "-w", "apps/web"]
