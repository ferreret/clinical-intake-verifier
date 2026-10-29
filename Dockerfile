# The verification app in one container (docs/deploy.md). What a deployment does is decided
# by its build arguments and its settings; nothing in the image knows which one it is.
#
# Build arguments:
#   BASE_PATH          the path the app is served under ("/name"), or none for the root
#   DEMO_DATA_URL      the archive of the replay demo's data (npm run pack-demo), from a release
#   DEMO_DATA_SHA256   its sha256: the build fails if the archive is not that one
#   NODE_IMAGE         the base image, by digest, so that a commit always builds the same image;
#                      Dependabot proposes the new digest when the image gets its fixes

ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

# --- The app, built standalone ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
# fields.json and the JSON Schemas are shared with the Python package, at the repository root.
COPY schema ./schema
COPY web ./web
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH NEXT_TELEMETRY_DISABLED=1
RUN cd web && npx next build

# --- The demo's data: synthetic documents, recorded replies, the starting memory -------------
FROM ${NODE_IMAGE} AS demo
WORKDIR /data
ARG DEMO_DATA_URL
ARG DEMO_DATA_SHA256
RUN node -e ' \
  const { DEMO_DATA_URL: url, DEMO_DATA_SHA256: want } = process.env; \
  if (!url || !want) throw new Error("set the build arguments DEMO_DATA_URL and DEMO_DATA_SHA256"); \
  fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) }).then(async (r) => { \
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); \
    const data = Buffer.from(await r.arrayBuffer()); \
    const got = require("node:crypto").createHash("sha256").update(data).digest("hex"); \
    if (got !== want) throw new Error(`the archive is not the expected one: sha256 ${got}`); \
    require("node:fs").writeFileSync("demo.tar.gz", data); \
  });' \
  && tar -xzf demo.tar.gz && rm demo.tar.gz

# --- What runs -------------------------------------------------------------------------------
FROM ${NODE_IMAGE}
WORKDIR /app/web
COPY --from=build /src/web/.next/standalone /app
COPY --from=build /src/web/.next/static ./.next/static
COPY --from=build /src/web/public ./public
COPY --from=demo /data/demo /app/demo
# The volume, and Next.js's cache of resized images, are written by the app's user.
RUN mkdir -p /app/state /app/web/.next/cache && chown -R node:node /app/state /app/web/.next/cache
USER node

# Replay mode on the demo's data; a deployment changes what it needs in its settings.
# HOSTNAME: Docker sets it to the container's id, and Next.js listens on it.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    APP_MODE=replay \
    APP_DATA_DIR=/app/state \
    DEMO_DOCUMENTS=/app/demo/documents \
    REPLAY_GEMINI_RUN=/app/demo/runs/gemini \
    REPLAY_LOCAL_RUN=/app/demo/runs/local \
    LIS_TEMPLATE=/app/demo/lis.sqlite \
    REPLAY_MAPPING=/app/demo/mapping.json \
    MAPPING_MODEL_CACHE=/app/state/model-cache

# The sandboxes (one SQLite file per visitor) and, in live mode, uploads: on a volume.
VOLUME /app/state
EXPOSE 3000

# Healthy once the app answers, under its path: a deployment then sends visitors to a new
# container only when it is ready, and a hung one is seen as such.
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + (process.env.BASE_PATH || '') + '/api/session', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server.js"]
