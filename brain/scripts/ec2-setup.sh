#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KOTG.AI — EC2 Development Machine Bootstrap Script
# Run on a fresh EC2 instance (Deep Learning AMI Ubuntu 22.04 or plain Ubuntu 22.04)
#
# Usage:
#   chmod +x ec2-setup.sh && ./ec2-setup.sh
#   OR from local machine:
#   scp -i ~/.ssh/kotg-dev.pem ec2-setup.sh ubuntu@<IP>:~/ && \
#   ssh -i ~/.ssh/kotg-dev.pem ubuntu@<IP> "bash ec2-setup.sh"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_FILE="$HOME/kotg-setup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*"; }
log_section() { echo -e "\n${BLUE}══════════════════════════════════════════${NC}"; echo -e "${BLUE}  $*${NC}"; echo -e "${BLUE}══════════════════════════════════════════${NC}"; }

log_section "KOTG.AI EC2 Bootstrap — $(date)"

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
OLLAMA_HOST="0.0.0.0"
OLLAMA_PORT="11434"
QDRANT_VERSION="v1.13.0"
QDRANT_PORT="6333"
QDRANT_DATA_DIR="/opt/qdrant/storage"

# Models to pull (in order — essential first)
MODELS=(
    "nomic-embed-text"           # embedding model, 274MB
    "qwen2.5:0.5b"              # nano model, 394MB
    "qwen2.5-coder:7b-instruct-q4_k_m"   # primary coding model, 4.7GB
    "qwen2.5:7b-instruct-q4_k_m"         # general reasoning, 4.7GB
)

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: System Update
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 1: System Update"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq \
    curl wget git htop screen tmux jq unzip \
    build-essential ca-certificates gnupg \
    lsb-release net-tools

log_info "System packages installed"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: GPU Check
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 2: GPU Detection"

if command -v nvidia-smi &>/dev/null; then
    GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "")
    if [ -n "$GPU_INFO" ]; then
        log_info "GPU detected: $GPU_INFO"
        HAS_GPU=true
    else
        log_warn "nvidia-smi present but no GPU found"
        HAS_GPU=false
    fi
else
    log_warn "No GPU detected — Ollama will use CPU (slower inference)"
    HAS_GPU=false
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Python + uv
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 3: Python & uv Setup"

# Install Python 3.12 if not present
if ! python3.12 --version &>/dev/null 2>&1; then
    sudo add-apt-repository ppa:deadsnakes/ppa -y
    sudo apt-get update -qq
    sudo apt-get install -y python3.12 python3.12-dev python3.12-venv
fi
log_info "Python: $(python3.12 --version)"

# Install uv
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env" 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
fi
log_info "uv: $(uv --version)"

# Persist PATH for uv in bashrc
if ! grep -q 'uv' "$HOME/.bashrc"; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Install Ollama
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 4: Ollama Installation"

if ! command -v ollama &>/dev/null; then
    log_info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
else
    log_info "Ollama already installed: $(ollama --version)"
fi

# Configure Ollama systemd override
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << EOF
[Service]
Environment="OLLAMA_HOST=${OLLAMA_HOST}:${OLLAMA_PORT}"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_ORIGINS=*"
EOF

sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl restart ollama

# Wait for Ollama to be ready
log_info "Waiting for Ollama to start..."
RETRIES=0
until curl -sf "http://localhost:${OLLAMA_PORT}/api/version" &>/dev/null; do
    sleep 2
    RETRIES=$((RETRIES + 1))
    if [ $RETRIES -gt 30 ]; then
        log_error "Ollama did not start in 60 seconds"
        sudo journalctl -u ollama -n 20 --no-pager
        exit 1
    fi
done

OLLAMA_VERSION=$(curl -sf "http://localhost:${OLLAMA_PORT}/api/version" | jq -r '.version' 2>/dev/null || echo "unknown")
log_info "Ollama running: version ${OLLAMA_VERSION}"

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Pull Models
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 5: Pulling Ollama Models"
log_info "This may take 10-30 minutes depending on internet speed..."

for MODEL in "${MODELS[@]}"; do
    log_info "Pulling model: $MODEL"
    if ollama pull "$MODEL"; then
        log_info "Successfully pulled: $MODEL"
    else
        log_warn "Failed to pull: $MODEL (continuing...)"
    fi
done

log_info "Models available:"
ollama list

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Install Docker
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 6: Docker Installation"

if ! command -v docker &>/dev/null; then
    log_info "Installing Docker..."
    sudo apt-get install -y docker.io docker-compose-plugin
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker "$USER"
    log_info "Docker installed. Note: log out and back in for group changes to take effect."
else
    log_info "Docker already installed: $(docker --version)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Install Qdrant
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 7: Qdrant Vector Database"

sudo mkdir -p "$QDRANT_DATA_DIR"
sudo chown -R "$USER:$USER" "$(dirname $QDRANT_DATA_DIR)"

# Check if Qdrant is already running
if docker ps --format '{{.Names}}' | grep -q '^qdrant$'; then
    log_info "Qdrant already running"
else
    log_info "Starting Qdrant ${QDRANT_VERSION}..."
    # Run with sudo if user not yet in docker group (first install)
    DOCKER_CMD="docker"
    if ! groups | grep -q docker; then
        DOCKER_CMD="sudo docker"
    fi

    $DOCKER_CMD run -d \
        --name qdrant \
        --restart unless-stopped \
        -p "${QDRANT_PORT}:6333" \
        -p "6334:6334" \
        -v "${QDRANT_DATA_DIR}:/qdrant/storage" \
        "qdrant/qdrant:${QDRANT_VERSION}"

    # Wait for Qdrant to be ready
    log_info "Waiting for Qdrant to start..."
    RETRIES=0
    until curl -sf "http://localhost:${QDRANT_PORT}/" &>/dev/null; do
        sleep 2
        RETRIES=$((RETRIES + 1))
        if [ $RETRIES -gt 30 ]; then
            log_error "Qdrant did not start in 60 seconds"
            break
        fi
    done
fi

QDRANT_STATUS=$(curl -sf "http://localhost:${QDRANT_PORT}/" | jq -r '.version' 2>/dev/null || echo "not responding")
log_info "Qdrant status: $QDRANT_STATUS"

# ─────────────────────────────────────────────────────────────────────────────
# Step 8: Create KOTG.AI environment file
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 8: KOTG.AI Environment"

# Get this instance's private IP
PRIVATE_IP=$(curl -sf http://169.254.169.254/latest/meta-data/local-ipv4 2>/dev/null || hostname -I | awk '{print $1}')
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "unknown")

cat > "$HOME/.kotg-env" << EOF
# KOTG.AI EC2 Development Environment
# Generated on: $(date)
# Instance: $(curl -sf http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "unknown")

# ── From EC2 (direct access) ──────────────────────────────────────────────
EC2_PUBLIC_IP=${PUBLIC_IP}
EC2_PRIVATE_IP=${PRIVATE_IP}
KOTG_OLLAMA_BASE_URL=http://${PUBLIC_IP}:11434
KOTG_QDRANT_URL=http://${PUBLIC_IP}:6333

# ── Via SSH Tunnel (recommended) ─────────────────────────────────────────
# KOTG_OLLAMA_BASE_URL=http://localhost:11434
# KOTG_QDRANT_URL=http://localhost:6333

# ── Models (pulled on this instance) ────────────────────────────────────
KOTG_MODEL_NANO_MODEL=qwen2.5:0.5b
KOTG_MODEL_SMALL_MODEL=qwen2.5-coder:7b-instruct-q4_k_m
KOTG_MODEL_MEDIUM_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_LARGE_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_EXPERT_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_EMBEDDING_MODEL=nomic-embed-text
KOTG_OLLAMA_TIMEOUT=120
KOTG_DEBUG=true
KOTG_LOG_LEVEL=DEBUG
KOTG_API_PORT=8080
EOF

log_info "Environment file written to ~/.kotg-env"
cat "$HOME/.kotg-env"

# ─────────────────────────────────────────────────────────────────────────────
# Step 9: Smoke Tests
# ─────────────────────────────────────────────────────────────────────────────
log_section "Step 9: Smoke Tests"

# Test Ollama
OLLAMA_OK=false
if curl -sf "http://localhost:11434/api/version" &>/dev/null; then
    log_info "Ollama API: OK"
    OLLAMA_OK=true
else
    log_error "Ollama API: FAILED"
fi

# Test Ollama inference
if $OLLAMA_OK; then
    RESPONSE=$(curl -sf "http://localhost:11434/api/generate" \
        -d '{"model":"qwen2.5:0.5b","prompt":"Say: OK","stream":false}' \
        | jq -r '.response' 2>/dev/null || echo "")
    if [ -n "$RESPONSE" ]; then
        log_info "Ollama inference: OK (response: '${RESPONSE:0:50}')"
    else
        log_warn "Ollama inference: No response (model may still be loading)"
    fi
fi

# Test Qdrant
if curl -sf "http://localhost:6333/" &>/dev/null; then
    log_info "Qdrant API: OK"
else
    log_warn "Qdrant API: Not responding yet (may still be starting)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
log_section "Setup Complete!"

echo ""
echo "  Service Endpoints:"
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  Ollama API:  http://${PUBLIC_IP}:11434          │"
echo "  │  Qdrant API:  http://${PUBLIC_IP}:6333           │"
echo "  └─────────────────────────────────────────────────┘"
echo ""
echo "  Pulled Models:"
ollama list 2>/dev/null || echo "  (ollama list failed)"
echo ""
echo "  SSH Tunnel (run on LOCAL machine):"
echo "  ─────────────────────────────────────────────────────"
echo "  ssh -N -L 11434:127.0.0.1:11434 -L 6333:127.0.0.1:6333 ubuntu@${PUBLIC_IP}"
echo "  ─────────────────────────────────────────────────────"
echo ""
echo "  Local .env configuration:"
echo "  ─────────────────────────────────────────────────────"
echo "  KOTG_OLLAMA_BASE_URL=http://localhost:11434  # via tunnel"
echo "  KOTG_QDRANT_URL=http://localhost:6333        # via tunnel"
echo "  ─────────────────────────────────────────────────────"
echo ""
echo "  Full env config: cat ~/.kotg-env"
echo "  Setup log:       $LOG_FILE"
echo ""
log_info "KOTG.AI EC2 development environment is ready!"
