# syntax=docker/dockerfile:1

# ── Build arguments — declared before any FROM so they scope globally ─────────
ARG NODE_VERSION=20
ARG NGINX_VERSION=1.27
ARG NODE_ENV=production

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder

# Re-declare ARGs after FROM (ARG scope resets per stage; must come before
# any RUN/COPY that consumes them — the old Dockerfile had this after COPY . .)
ARG NODE_ENV
ENV NODE_ENV=${NODE_ENV}

WORKDIR /app

# Layer: deps — only invalidated when package*.json changes
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# Layer: source — invalidated on any source change
COPY . .

RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM nginx:${NGINX_VERSION}-alpine AS runtime

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy and validate nginx config — nginx -t catches syntax errors at build time
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN nginx -t

# nginx's built-in 'nginx' user (uid 101) must own the dirs it writes to
# so the worker processes can run without root
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
