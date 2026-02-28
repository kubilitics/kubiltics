#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KOTG.AI — SSH Tunnel Manager
# Forwards EC2 ports to localhost for local development.
#
# Usage:
#   ./scripts/dev-tunnel.sh                    # use 'kotg-dev' from ~/.ssh/config
#   ./scripts/dev-tunnel.sh 3.236.160.63       # pass IP directly
#   ./scripts/dev-tunnel.sh --stop             # kill active tunnel
#   ./scripts/dev-tunnel.sh --status           # check tunnel status
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

KEY_FILE="${HOME}/.ssh/kotg-key.pem"
SSH_HOST="${1:-kotg-dev}"
PID_FILE="/tmp/kotg-tunnel.pid"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info() { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }

# Port forwards: local -> EC2
FORWARDS=(
    "11434:127.0.0.1:11434"  # Ollama API
    "6333:127.0.0.1:6333"    # Qdrant HTTP
    "6334:127.0.0.1:6334"    # Qdrant gRPC
    "8080:127.0.0.1:8080"    # KOTG API
)

case "${SSH_HOST}" in
--stop|stop)
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            log_info "Tunnel stopped (PID $PID)"
        else
            log_warn "Tunnel PID $PID not running"
        fi
        rm -f "$PID_FILE"
    else
        # Try pkill as fallback
        pkill -f "kotg-tunnel" 2>/dev/null && log_info "Tunnel killed" || log_warn "No tunnel found"
    fi
    exit 0
    ;;
--status|status)
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            log_info "Tunnel active (PID $PID)"
            echo "  Ollama: http://localhost:11434"
            echo "  Qdrant: http://localhost:6333"
            echo "  API:    http://localhost:8080"
            # Quick health checks
            curl -sf http://localhost:11434/api/version &>/dev/null && \
                echo -e "  ${GREEN}Ollama: responding${NC}" || \
                echo -e "  ${YELLOW}Ollama: not responding${NC}"
            curl -sf http://localhost:6333/ &>/dev/null && \
                echo -e "  ${GREEN}Qdrant: responding${NC}" || \
                echo -e "  ${YELLOW}Qdrant: not responding${NC}"
        else
            log_warn "PID file exists but tunnel is not running"
            rm -f "$PID_FILE"
        fi
    else
        log_warn "No tunnel PID file. Tunnel may not be running."
    fi
    exit 0
    ;;
esac

# Build forward args
FORWARD_ARGS=()
for FWD in "${FORWARDS[@]}"; do
    FORWARD_ARGS+=("-L" "$FWD")
done

# Kill existing tunnel if running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    kill -0 "$OLD_PID" 2>/dev/null && kill "$OLD_PID" && log_info "Stopped previous tunnel (PID $OLD_PID)"
    rm -f "$PID_FILE"
fi

# Determine SSH command args
SSH_ARGS=(-o "ServerAliveInterval=30" -o "ServerAliveCountMax=5" -o "StrictHostKeyChecking=no")

# If SSH_HOST looks like an IP, add key + user
if [[ "$SSH_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SSH_ARGS+=(-i "$KEY_FILE")
    SSH_TARGET="ubuntu@${SSH_HOST}"
else
    # Named host from ~/.ssh/config
    SSH_TARGET="$SSH_HOST"
fi

# Prefer autossh if available (auto-reconnects on drop)
if command -v autossh &>/dev/null; then
    log_info "Starting persistent tunnel via autossh to ${SSH_TARGET}..."
    AUTOSSH_GATETIME=0 autossh -M 0 -f -N \
        "${SSH_ARGS[@]}" "${FORWARD_ARGS[@]}" "$SSH_TARGET" \
        -o "ExitOnForwardFailure=yes"
    # Find and save PID
    sleep 1
    NEW_PID=$(pgrep -n -f "ssh.*11434.*${SSH_HOST}" || true)
else
    log_warn "autossh not found — using plain ssh (no auto-reconnect)"
    log_warn "Install autossh: brew install autossh  (macOS) | sudo apt install autossh"
    ssh -f -N "${SSH_ARGS[@]}" "${FORWARD_ARGS[@]}" "$SSH_TARGET"
    sleep 1
    NEW_PID=$(pgrep -n -f "ssh.*11434.*${SSH_HOST}" || true)
fi

if [ -n "$NEW_PID" ]; then
    echo "$NEW_PID" > "$PID_FILE"
    log_info "Tunnel started (PID $NEW_PID)"
else
    log_warn "Could not determine tunnel PID (tunnel may still be running)"
fi

echo ""
echo "  Local endpoints (forwarded from EC2):"
echo "  ┌────────────────────────────────────────────────┐"
echo "  │  Ollama:  http://localhost:11434               │"
echo "  │  Qdrant:  http://localhost:6333                │"
echo "  │  API:     http://localhost:8080                │"
echo "  └────────────────────────────────────────────────┘"
echo ""
echo "  Stop:   ./scripts/dev-tunnel.sh --stop"
echo "  Status: ./scripts/dev-tunnel.sh --status"
echo ""

# Wait a moment then verify Ollama is reachable
sleep 2
if curl -sf http://localhost:11434/api/version &>/dev/null; then
    OLLAMA_VER=$(curl -sf http://localhost:11434/api/version | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "ok")
    log_info "Ollama reachable: version ${OLLAMA_VER}"
else
    log_warn "Ollama not yet responding on localhost:11434 (may take a moment)"
fi
