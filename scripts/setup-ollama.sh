#!/usr/bin/env bash
# setup-ollama.sh — one-shot Ollama installer for a throwaway cloud VM.
#
# Sets up a lightweight Ollama endpoint you can point Kubilitics at during
# the monorepo migration window. Defaults to qwen2.5:3b (~2 GB, runs OK on
# 4 GB RAM / 2 vCPU).
#
# Target OS: Ubuntu 22.04+, Debian 12+, Amazon Linux 2023. Anything with
# systemd and curl should work.
#
# Usage:
#   sudo bash setup-ollama.sh                       # default model qwen2.5:3b
#   sudo MODEL=qwen2.5:7b bash setup-ollama.sh      # 7b needs 8 GB RAM
#   sudo MODEL=llama3.2:3b bash setup-ollama.sh     # alternative
#
# Security note: binds 0.0.0.0:11434 (accepts external traffic). Protect
# via your cloud firewall / security group — DO NOT expose to the public
# internet. Recommended: allow only your laptop IP on port 11434.

set -euo pipefail

MODEL="${MODEL:-qwen2.5:3b}"
PORT="${PORT:-11434}"
OLLAMA_HOST_BINDING="0.0.0.0:${PORT}"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run with sudo (needed to install Ollama and edit systemd unit)" >&2
    exit 1
  fi
}

install_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    echo "ok: ollama already installed ($(ollama --version | head -1))"
    return
  fi
  echo "=> installing ollama (official script)"
  curl -fsSL https://ollama.com/install.sh | sh
}

bind_external() {
  local unit=/etc/systemd/system/ollama.service
  if [ ! -f "$unit" ]; then
    echo "ERROR: $unit not found after install — aborting" >&2
    exit 1
  fi
  # Idempotent: remove any prior OLLAMA_HOST line, then insert fresh.
  echo "=> binding ollama to ${OLLAMA_HOST_BINDING} (was: loopback only)"
  sed -i '/^Environment="OLLAMA_HOST=/d' "$unit"
  sed -i "/^\[Service\]/a Environment=\"OLLAMA_HOST=${OLLAMA_HOST_BINDING}\"" "$unit"
  systemctl daemon-reload
  systemctl enable --now ollama
  systemctl restart ollama
  sleep 3
}

pull_model() {
  echo "=> pulling model ${MODEL} (this can take 3–10 minutes depending on bandwidth)"
  # Ollama pulls to $HOME/.ollama; set HOME explicitly so root-run installs
  # don't panic on a missing $HOME under systemd.
  HOME=/root ollama pull "${MODEL}"
}

smoke_test() {
  echo "=> smoke-testing the endpoint"
  curl -sf --max-time 10 "http://127.0.0.1:${PORT}/api/tags" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); m=[x['name'] for x in d.get('models',[])]; print(f'models installed: {m}')" \
    || { echo "ERROR: /api/tags did not respond — check systemctl status ollama" >&2; exit 1; }

  echo "=> one-shot completion test"
  curl -sf --max-time 60 -X POST "http://127.0.0.1:${PORT}/api/generate" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"model":"%s","prompt":"Say OK in one word.","stream":false}' "$MODEL")" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'response: {d.get(\"response\",\"<none>\")!r}  eval_count={d.get(\"eval_count\",0)}')"
}

print_next_steps() {
  local public_ip
  public_ip="$(curl -sf --max-time 3 https://api.ipify.org 2>/dev/null || echo 'YOUR_VM_PUBLIC_IP')"
  cat <<EOF

=====================================================================
  OLLAMA READY
=====================================================================

  Endpoint (from this VM):        http://127.0.0.1:${PORT}
  Endpoint (from outside):        http://${public_ip}:${PORT}
  Model:                          ${MODEL}

  FIREWALL / SECURITY GROUP:
    Allow inbound TCP ${PORT} from YOUR_LAPTOP_IP only.
    Do NOT allow 0.0.0.0/0 — Ollama has no authentication.

  VERIFY FROM YOUR LAPTOP:
    curl http://${public_ip}:${PORT}/api/tags

  POINT KUBILITICS AT THIS ENDPOINT:
    1. Open Kubilitics → Settings → AI (or http://localhost:5173/ai)
    2. Provider:   ollama
    3. Base URL:   http://${public_ip}:${PORT}
    4. Model:      ${MODEL}
    5. Save + click "Validate connection"

  TEARDOWN WHEN DONE:
    sudo systemctl stop ollama
    sudo systemctl disable ollama
    # (or just terminate the VM)

=====================================================================
EOF
}

main() {
  require_root
  install_ollama
  bind_external
  pull_model
  smoke_test
  print_next_steps
}

main "$@"
