#!/bin/sh
# docker-entrypoint.sh — Runtime configuration injection for Kubilitics frontend.
#
# In desktop mode, API URLs are known at build time (localhost:819).
# In-cluster mode, the backend Service hostname varies per deployment.
# This script replaces build-time placeholder strings in the compiled JS bundle
# with runtime values from environment variables BEFORE nginx starts.
#
# Environment variables:
#   KUBILITICS_BACKEND_URL  - Backend API base URL (default: http://backend:819)
#   KUBILITICS_WS_URL       - WebSocket base URL (default: derived from KUBILITICS_BACKEND_URL)
#   KUBILITICS_AI_URL       - AI service URL (default: http://kubilitics-ai:8081)
#
# The Vite build produces JS files with:
#   import.meta.env.VITE_BACKEND_URL → "http://localhost:819" (build-time default)
#
# This script replaces those hardcoded localhost URLs with the actual service URLs.

set -e

STATIC_DIR="/usr/share/nginx/html"

# Default URLs for in-cluster mode (using Kubernetes service DNS)
BACKEND_URL="${KUBILITICS_BACKEND_URL:-}"
WS_URL="${KUBILITICS_WS_URL:-}"
AI_URL="${KUBILITICS_AI_URL:-}"

echo "[entrypoint] Kubilitics frontend runtime config injection"
echo "[entrypoint] KUBILITICS_BACKEND_URL=${BACKEND_URL:-<not set, using build defaults>}"
echo "[entrypoint] KUBILITICS_AI_URL=${AI_URL:-<not set, using build defaults>}"

# Generate runtime config that the frontend can pick up
# This creates a config.js that sets window.__KUBILITICS_CONFIG__
CONFIG_FILE="${STATIC_DIR}/config.js"

cat > "${CONFIG_FILE}" <<CONFIGEOF
// Runtime configuration — injected by docker-entrypoint.sh at container startup.
// This file is loaded before the main bundle via a <script> tag in index.html.
window.__KUBILITICS_CONFIG__ = {
  BACKEND_URL: "${BACKEND_URL}",
  WS_URL: "${WS_URL}",
  AI_URL: "${AI_URL}",
  IN_CLUSTER: "true",
  AUTH_REQUIRED: "${KUBILITICS_AUTH_REQUIRED:-true}"
};
CONFIGEOF

echo "[entrypoint] Generated ${CONFIG_FILE}"

# Inject <script src="/config.js"> into index.html if not already present
INDEX_FILE="${STATIC_DIR}/index.html"
if [ -f "${INDEX_FILE}" ]; then
  if ! grep -q 'config.js' "${INDEX_FILE}"; then
    # Insert config.js script tag before the first existing <script> tag.
    # Use actual newline (not \n) because BusyBox sed on Alpine treats \n literally.
    sed -i 's|<script|<script src="/config.js"></script>\
    <script|' "${INDEX_FILE}"
    echo "[entrypoint] Injected config.js script tag into index.html"
  fi
fi

# Additionally, replace any hardcoded localhost URLs in JS bundles
# This catches any VITE_* env vars that were baked in at build time
if [ -n "${BACKEND_URL}" ]; then
  echo "[entrypoint] Replacing localhost:819 references in JS bundles..."
  find "${STATIC_DIR}" -name '*.js' -exec \
    sed -i "s|http://localhost:819|${BACKEND_URL}|g" {} + 2>/dev/null || true
  find "${STATIC_DIR}" -name '*.js' -exec \
    sed -i "s|http://127.0.0.1:819|${BACKEND_URL}|g" {} + 2>/dev/null || true
fi

if [ -n "${AI_URL}" ]; then
  echo "[entrypoint] Replacing localhost:8081 references in JS bundles..."
  find "${STATIC_DIR}" -name '*.js' -exec \
    sed -i "s|http://localhost:8081|${AI_URL}|g" {} + 2>/dev/null || true
  find "${STATIC_DIR}" -name '*.js' -exec \
    sed -i "s|ws://localhost:8081|${AI_URL}|g" {} + 2>/dev/null || true
fi

echo "[entrypoint] Configuration injection complete. Starting nginx..."

# Execute the CMD (nginx)
exec "$@"
