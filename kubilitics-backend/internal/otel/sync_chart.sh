#!/usr/bin/env bash
# sync_chart.sh — copy charts/kubilitics-otel/ into internal/otel/chart/ so
# the embedded chart used by the backend stays in sync with the top-level
# chart that's published to oci://ghcr.io/vellankikoti/charts/kubilitics-otel.
#
# Invoked by `go generate ./internal/otel/...` (see chart_embed.go) and the
# CI workflow before building the backend binary.
#
# This script is idempotent. If the embedded copy is already byte-identical
# to the source, it's a no-op.

set -euo pipefail

# Resolve the repo root from this script's location:
#   kubilitics-backend/internal/otel/sync_chart.sh
#   → ../../.. = kubilitics-backend
#   → ../../../.. = repo root (where charts/ lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

SOURCE="$REPO_ROOT/charts/kubilitics-otel"
DEST="$SCRIPT_DIR/chart"

if [ ! -d "$SOURCE" ]; then
    echo "ERROR: source chart not found at $SOURCE" >&2
    exit 1
fi
if [ ! -f "$SOURCE/Chart.yaml" ]; then
    echo "ERROR: $SOURCE is not a valid Helm chart (no Chart.yaml)" >&2
    exit 1
fi

# Wipe and re-copy. Using rsync would be cleaner but introduces a dependency;
# rm -rf + cp -R is portable and just as fast for a 10-file chart.
rm -rf "$DEST"
cp -R "$SOURCE" "$DEST"

echo "synced $SOURCE → $DEST ($(find "$DEST" -type f | wc -l | tr -d ' ') files)"
