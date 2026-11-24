# syntax=docker/dockerfile:1
# Starwake: one image, one port. Build from the repo root with ./build.sh (it stamps the version).
# Base image pinned by digest (Node LTS, R8); bump both tag and digest together.
ARG NODE_IMAGE=node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
# build_ca: optional CA bundle for builders behind a TLS-inspecting proxy (build.sh --ca FILE).
# A BuildKit secret, so it never lands in a layer.
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/client apps/client
COPY content content
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --omit=dev --no-audit --no-fund -w @starwake/shared -w @starwake/server \
    && npm cache clean --force
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/client/dist apps/client/dist
COPY --from=build /src/content content
RUN mkdir -p /data && chown node:node /data

ARG STARWAKE_VERSION=dev
ARG STARWAKE_GIT_SHA=unknown
ARG STARWAKE_BUILT_AT=unknown
ENV STARWAKE_VERSION=${STARWAKE_VERSION} \
    STARWAKE_GIT_SHA=${STARWAKE_GIT_SHA} \
    STARWAKE_BUILT_AT=${STARWAKE_BUILT_AT} \
    DATA_DIR=/data \
    LISTEN_PORT=8080 \
    CONTENT_DIR=/app/content
LABEL org.opencontainers.image.title="starwake" \
      org.opencontainers.image.source="https://github.com/ennissh/starwake" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.version="${STARWAKE_VERSION}" \
      org.opencontainers.image.revision="${STARWAKE_GIT_SHA}"

USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "apps/server/dist/healthcheck.js"]
CMD ["node", "apps/server/dist/index.js"]
