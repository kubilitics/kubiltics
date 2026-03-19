# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Kubilitics Frontend — optimized production build
#
# Key optimizations:
#   1. npm ci --ignore-scripts  → skips Playwright browser downloads (~150MB)
#   2. npm cache mount          → deps cached across builds
#   3. Minimal nginx runtime    → final image ~25MB
#
# Build:  docker buildx build -t kubilitics-frontend:local .
# Bake:   docker buildx bake frontend       (from repo root)
#
# Portability:  Uses --chmod on COPY so the image is correct regardless of
#               host OS file permissions (macOS, Linux, Windows/WSL).
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=20
ARG NGINX_VERSION=1.27

# ── Stage 1: Install deps + build ───────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS build

# Increase Node memory for large builds (Monaco, Three.js, etc.)
ENV NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR /app

# Layer 1 — deps (cached unless package*.json change)
COPY package*.json ./

# --ignore-scripts: Skips postinstall hooks (Playwright browser downloads,
#   Storybook telemetry, etc.) that are irrelevant for production build.
#   This alone saves ~150MB download + 30-60s of install time.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# Layer 2 — source + compile
COPY . .
RUN npm run build

# ── Stage 2: Serve with nginx ───────────────────────────────────────────────
FROM nginx:${NGINX_VERSION}-alpine

# --chmod / --chown on COPY: guarantees correct permissions regardless of
# host OS (macOS defaults to 700 for scripts, Windows has no Unix perms).
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chmod=644 nginx.conf           /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

# Ensure nginx user owns all writable runtime paths (including html dir for entrypoint config.js injection)
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
