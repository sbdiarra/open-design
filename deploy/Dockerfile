ARG NODE_IMAGE=docker.io/library/node:24-alpine
ARG RUNTIME_IMAGE=docker.io/library/node:24-alpine

FROM ${NODE_IMAGE} AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true
# Coolify forwards runtime NODE_OPTIONS into build RUN steps. Keep the runtime
# heap small, but override it while installing/building so TypeScript/esbuild
# postinstall work does not OOM under --max-old-space-size=192.
ENV OD_BUILD_NODE_OPTIONS=--max-old-space-size=1024

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages ./packages
COPY tools ./tools
COPY apps ./apps
COPY e2e/package.json ./e2e/package.json
RUN corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    NODE_OPTIONS=${OD_BUILD_NODE_OPTIONS} pnpm install --frozen-lockfile

RUN NODE_OPTIONS=${OD_BUILD_NODE_OPTIONS} pnpm --filter @open-design/daemon build && \
    NODE_OPTIONS=${OD_BUILD_NODE_OPTIONS} pnpm --filter @open-design/web build && \
    NODE_OPTIONS=${OD_BUILD_NODE_OPTIONS} pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

# Stage-2 assets — copied into the build stage so the runtime stage
# can pull them via --from=build instead of reaching back into the
# build context.  This lets the Dockerfile work when the build context
# differs from the repo root (Railway, CI runners with a subdirectory
# context, etc.).
COPY skills ./skills
COPY design-systems ./design-systems
COPY craft ./craft
COPY prompt-templates ./prompt-templates
COPY assets ./assets
COPY plugins/_official ./plugins/_official

FROM ${RUNTIME_IMAGE}

ARG INSTALL_KILO_CLI=true

RUN apk add --no-cache \
    bash \
    curl \
    git \
    jq \
    openssl \
    tini \
    poppler-utils \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    font-noto \
    font-noto-cjk \
    font-noto-emoji \
    imagemagick \
    librsvg \
    rsvg-convert && \
    if [ "${INSTALL_KILO_CLI}" = "true" ]; then npm install -g @kilocode/cli; fi

WORKDIR /app

COPY --from=build --chown=node:node /app/deploy/daemon ./apps/daemon
COPY --from=build --chown=node:node /app/apps/web/out ./apps/web/out
COPY --from=build --chown=node:node /app/skills ./skills
COPY --from=build --chown=node:node /app/design-systems ./design-systems
COPY --from=build --chown=node:node /app/craft ./craft
COPY --from=build --chown=node:node /app/prompt-templates ./prompt-templates
COPY --from=build --chown=node:node /app/assets/frames ./assets/frames
COPY --from=build --chown=node:node /app/assets/community-pets ./assets/community-pets

# COPY --from=build --chown=open-design:open-design /app/deploy/daemon ./apps/daemon
# COPY --from=build --chown=open-design:open-design /app/apps/web/out ./apps/web/out
# COPY --from=build --chown=open-design:open-design /app/skills ./skills
# COPY --from=build --chown=open-design:open-design /app/design-systems ./design-systems
# COPY --from=build --chown=open-design:open-design /app/craft ./craft
# COPY --from=build --chown=open-design:open-design /app/prompt-templates ./prompt-templates
# COPY --from=build --chown=open-design:open-design /app/assets/frames ./assets/frames
# COPY --from=build --chown=open-design:open-design /app/assets/community-pets ./assets/community-pets
# Plan §3.J4 / spec §23.3.5 — bundled atom plugins registered on
# daemon boot. The directory contains `plugins/_official/atoms/<atom>/`
# pairs (SKILL.md + open-design.json); registerBundledPlugins() walks
# it on startup so the container ships with first-party atoms reachable
# via the same registry path third-party plugins use.
COPY --from=build --chown=node:node /app/plugins/_official ./plugins/_official
# COPY --from=build --chown=open-design:open-design /app/plugins/_official ./plugins/_official

# Initialise a minimal git repository at /app so Kilo/OpenCode can resolve a
# real project root when spawned with a cwd under /app/.od/projects/.
# Without .git, Kilo records root="/" and triggers a full-filesystem walk;
# with it, root="/app" (a fast image-layer path with no .kilo/ plugin tree).
# The .gitignore prevents Kilo from indexing build outputs and runtime data.
RUN git init /app && \
    printf 'node_modules/\n.od/\ndist/\nout/\n' > /app/.gitignore && \
    git -C /app config user.email "build@open-design" && \
    git -C /app config user.name "Open Design Build" && \
    mkdir -p /app/.od/home && \
    chown -R node:node /app

ENV NODE_ENV=production
ENV HOME=/app/.od/home
ENV NODE_OPTIONS=--max-old-space-size=192
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 7456

USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
