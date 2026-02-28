# KOTG.AI Development Machine Setup

**Purpose:** Provision an AWS EC2 instance as a shared Ollama inference backend for local KOTG.AI development and API/MCP testing.

**Architecture:**
```
Local Machine (dev) ─── SSH Tunnel / Direct ──► EC2 (Ollama + Qdrant)
     │                                                │
     ├── KOTG.AI Python code                         ├── Ollama :11434
     ├── pytest / API tests                          ├── Qdrant :6333
     └── MCP client (Claude Desktop)                 └── KOTG API :8080
```

---

## Table of Contents

1. [Instance Recommendation](#1-instance-recommendation)
2. [Step 1 — Launch EC2 Instance](#2-step-1--launch-ec2-instance)
3. [Step 2 — Security Group Rules](#3-step-2--security-group-rules)
4. [Step 3 — Bootstrap the Server](#4-step-3--bootstrap-the-server)
5. [Step 4 — Install Ollama](#5-step-4--install-ollama)
6. [Step 5 — Pull Models](#6-step-5--pull-models)
7. [Step 6 — Install Qdrant](#7-step-6--install-qdrant)
8. [Step 7 — Secure Remote Access](#8-step-7--secure-remote-access)
9. [Step 8 — Configure Local Machine](#9-step-8--configure-local-machine)
10. [Step 9 — Verify Everything Works](#10-step-9--verify-everything-works)
11. [Step 10 — Run KOTG.AI APIs & MCPs](#11-step-10--run-kotgai-apis--mcps)
12. [Cost Estimation](#12-cost-estimation)
13. [Automated Bootstrap Script](#13-automated-bootstrap-script)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Instance Recommendation

### Primary: GPU Instance (Recommended for Development)

| Spec        | Value                                    |
|-------------|------------------------------------------|
| **Type**    | `g4dn.xlarge`                            |
| **GPU**     | NVIDIA T4 — 16 GB VRAM                  |
| **CPU**     | 4 vCPUs (Intel Cascade Lake)            |
| **RAM**     | 16 GB                                    |
| **Storage** | 125 GB NVMe SSD (root) + 200 GB EBS gp3 |
| **Cost**    | ~$0.526/hr on-demand, ~$0.16/hr spot    |
| **Best for**| qwen2.5-coder:7b, qwen2.5:7b, bge-m3   |

Why T4: 16 GB VRAM fits a 7B model at Q4_K_M quantization with room for KV cache.
Inference is 5–8× faster than CPU for the same model.

### Budget Alternative: CPU Instance

| Spec        | Value                                    |
|-------------|------------------------------------------|
| **Type**    | `m5.2xlarge`                             |
| **CPU**     | 8 vCPUs                                  |
| **RAM**     | 32 GB                                    |
| **Storage** | 200 GB EBS gp3                           |
| **Cost**    | ~$0.384/hr on-demand, ~$0.12/hr spot    |
| **Best for**| Development/testing with smaller models  |

### AMI

- **Primary:** `Deep Learning OSS Nvidia Driver AMI GPU PyTorch (Ubuntu 22.04)` — has CUDA pre-installed
- **AMI ID lookup:** `aws ec2 describe-images --owners amazon --filters "Name=name,Values=Deep Learning OSS*PyTorch*Ubuntu 22*" --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text --region us-east-1`
- **CPU Fallback:** Ubuntu 22.04 LTS (us-east-1: `ami-0c7217cdde317cfec`)

---

## 2. Step 1 — Launch EC2 Instance

### Option A: AWS CLI (Fastest)

```bash
# Install AWS CLI if not present
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Configure credentials
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region (us-east-1), Output (json)

# Create a key pair (skip if you have one)
aws ec2 create-key-pair \
  --key-name kotg-dev \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/kotg-dev.pem
chmod 400 ~/.ssh/kotg-dev.pem

# Get your VPC default subnet
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=defaultForAz,Values=true" \
  --query 'Subnets[0].SubnetId' \
  --output text)

# Get default VPC ID
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query 'Vpcs[0].VpcId' \
  --output text)

# Create security group
SG_ID=$(aws ec2 create-security-group \
  --group-name kotg-dev-sg \
  --description "KOTG.AI development security group" \
  --vpc-id $VPC_ID \
  --query 'GroupId' \
  --output text)

echo "Security Group: $SG_ID"

# Add security group rules (see Step 2 for details)
MY_IP=$(curl -s https://checkip.amazonaws.com)

# SSH from your IP only
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 22 --cidr ${MY_IP}/32

# Ollama from your IP only (NOT 0.0.0.0 — keep private)
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 11434 --cidr ${MY_IP}/32

# Qdrant from your IP only
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 6333 --cidr ${MY_IP}/32

# KOTG API from your IP only
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 8080 --cidr ${MY_IP}/32

# Get the Deep Learning AMI (GPU, Ubuntu 22)
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters \
    "Name=name,Values=Deep Learning OSS Nvidia Driver AMI GPU PyTorch*Ubuntu 22*" \
    "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
  --output text)

echo "Using AMI: $AMI_ID"

# Launch the instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type g4dn.xlarge \
  --key-name kotg-dev \
  --security-group-ids $SG_ID \
  --subnet-id $SUBNET_ID \
  --block-device-mappings '[
    {
      "DeviceName": "/dev/sda1",
      "Ebs": {
        "VolumeSize": 200,
        "VolumeType": "gp3",
        "Throughput": 250,
        "DeleteOnTermination": true
      }
    }
  ]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=kotg-dev},{Key=Project,Value=KOTG.AI}]' \
  --query 'Instances[0].InstanceId' \
  --output text)

echo "Instance ID: $INSTANCE_ID"

# Wait for instance to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID
echo "Instance is running!"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo ""
echo "============================================"
echo "EC2 Instance Ready!"
echo "Public IP:    $PUBLIC_IP"
echo "Instance ID:  $INSTANCE_ID"
echo "SSH Command:  ssh -i ~/.ssh/kotg-dev.pem ubuntu@$PUBLIC_IP"
echo "============================================"
```

### Option B: AWS Console (Manual)

1. Go to **EC2 > Launch Instance**
2. **Name:** `kotg-dev`
3. **AMI:** Search "Deep Learning OSS Nvidia Driver AMI GPU PyTorch Ubuntu 22" → select latest
4. **Instance type:** `g4dn.xlarge` (or `m5.2xlarge` for CPU-only)
5. **Key pair:** Create or select existing → download `.pem` file
6. **Network settings:** Create security group `kotg-dev-sg`
7. **Storage:** Set root volume to **200 GiB, gp3**
8. **Tags:** `Name=kotg-dev`, `Project=KOTG.AI`
9. Click **Launch Instance**

---

## 3. Step 2 — Security Group Rules

| Port  | Protocol | Source        | Purpose                           |
|-------|----------|---------------|-----------------------------------|
| 22    | TCP      | Your IP /32   | SSH access                        |
| 11434 | TCP      | Your IP /32   | Ollama API                        |
| 6333  | TCP      | Your IP /32   | Qdrant HTTP API                   |
| 6334  | TCP      | Your IP /32   | Qdrant gRPC (optional)           |
| 8080  | TCP      | Your IP /32   | KOTG.AI API server                |

**Security Note:** Never open ports 11434 or 6333 to `0.0.0.0/0`. Ollama has no built-in authentication. Restrict to your IP or use SSH tunnel (recommended).

---

## 4. Step 3 — Bootstrap the Server

SSH into the instance:

```bash
ssh -i ~/.ssh/kotg-dev.pem ubuntu@<PUBLIC_IP>
```

Run system updates and install prerequisites:

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install required tools
sudo apt-get install -y \
  curl \
  wget \
  git \
  htop \
  nvtop \
  screen \
  tmux \
  jq \
  unzip \
  build-essential \
  python3.12 \
  python3.12-dev \
  python3-pip \
  ca-certificates \
  gnupg \
  lsb-release

# Verify GPU (skip if CPU instance)
nvidia-smi
# Expected: NVIDIA T4 with ~16 GB VRAM

# Install uv (fast Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc
uv --version
```

---

## 5. Step 4 — Install Ollama

```bash
# Install Ollama (official one-liner)
curl -fsSL https://ollama.com/install.sh | sh

# Verify installation
ollama --version
# Expected: ollama version 0.5.x or later

# Configure Ollama to listen on all interfaces
# (security group already restricts who can reach it)
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_ORIGINS=*"
EOF

# Reload and restart Ollama
sudo systemctl daemon-reload
sudo systemctl restart ollama
sudo systemctl enable ollama
sudo systemctl status ollama

# Verify Ollama is listening
curl http://localhost:11434/api/version
# Expected: {"version":"0.5.x"}
```

---

## 6. Step 5 — Pull Models

Pull models in priority order. Each pull takes 2–10 minutes depending on model size.

```bash
# ── Tier 1: Embedding model (always needed, small and fast) ──────────────────
ollama pull nomic-embed-text
# Size: ~274 MB | Context: 8192 tokens

# ── Tier 2: Nano model (routing, triage, simple intent) ─────────────────────
ollama pull qwen2.5:0.5b
# Size: ~394 MB | Fast: <200ms on GPU

# ── Tier 3: Small coding model (YAML generation, tool calling) ───────────────
ollama pull qwen2.5-coder:7b-instruct-q4_k_m
# Size: ~4.7 GB | PRIMARY development model

# ── Tier 4: General reasoning (diagnosis, explanation) ──────────────────────
ollama pull qwen2.5:7b-instruct-q4_k_m
# Size: ~4.7 GB | Good for diagnosis ReAct loops

# ── Optional: BGE-M3 embedding (better for production) ───────────────────────
# ollama pull bge-m3
# Size: ~1.2 GB | Better multilingual + technical content

# Verify all models
ollama list
# Expected output:
# NAME                                 ID              SIZE    MODIFIED
# qwen2.5-coder:7b-instruct-q4_k_m   ...             4.7 GB  ...
# qwen2.5:7b-instruct-q4_k_m         ...             4.7 GB  ...
# qwen2.5:0.5b                        ...             394 MB  ...
# nomic-embed-text                    ...             274 MB  ...

# Quick smoke test
ollama run qwen2.5:0.5b "Say hello in one sentence"
# Should respond in <5 seconds on GPU
```

---

## 7. Step 6 — Install Qdrant

```bash
# Create data directory
sudo mkdir -p /opt/qdrant/storage
sudo chown ubuntu:ubuntu /opt/qdrant

# Option A: Docker (recommended for easy upgrades)
# Install Docker
sudo apt-get install -y docker.io
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ubuntu
newgrp docker

# Run Qdrant in Docker
docker run -d \
  --name qdrant \
  --restart unless-stopped \
  -p 6333:6333 \
  -p 6334:6334 \
  -v /opt/qdrant/storage:/qdrant/storage \
  qdrant/qdrant:v1.13.0

# Verify Qdrant is running
curl http://localhost:6333/
# Expected: {"title":"qdrant - vector search engine","version":"1.13.0",...}

# Option B: Binary (no Docker)
# wget https://github.com/qdrant/qdrant/releases/download/v1.13.0/qdrant-x86_64-unknown-linux-gnu.tar.gz
# tar -xzf qdrant-x86_64-unknown-linux-gnu.tar.gz
# sudo mv qdrant /usr/local/bin/
# qdrant &
```

---

## 8. Step 7 — Secure Remote Access

### Option A: SSH Tunnel (Recommended — Most Secure)

Run this on your **local machine** (not EC2). This forwards EC2 ports to localhost:

```bash
# Create SSH tunnel config in ~/.ssh/config on LOCAL machine
cat >> ~/.ssh/config << 'EOF'

Host kotg-dev
    HostName <YOUR_EC2_PUBLIC_IP>
    User ubuntu
    IdentityFile ~/.ssh/kotg-dev.pem
    ServerAliveInterval 60
    ServerAliveCountMax 3
    # Port forwards: local:port -> EC2:port
    LocalForward 11434 127.0.0.1:11434
    LocalForward 6333 127.0.0.1:6333
    LocalForward 6334 127.0.0.1:6334
    LocalForward 8080 127.0.0.1:8080
EOF

# Connect (keep this terminal open while developing)
ssh kotg-dev -N &
# Or foreground: ssh kotg-dev -N

# Now on your local machine, Ollama is at:
# http://localhost:11434   (tunneled from EC2)
# http://localhost:6333    (Qdrant tunneled from EC2)
```

For persistent tunnel (auto-reconnect):

```bash
# Install autossh on local machine
# macOS:    brew install autossh
# Ubuntu:   sudo apt install autossh

autossh -M 20000 -f -N kotg-dev
# Runs in background, auto-reconnects if connection drops
```

### Option B: Direct Access (Simpler, Less Secure)

Skip SSH tunnel. Access EC2 directly. Requires security group port rules already set.

```
Ollama endpoint: http://<EC2_PUBLIC_IP>:11434
Qdrant endpoint: http://<EC2_PUBLIC_IP>:6333
KOTG API:        http://<EC2_PUBLIC_IP>:8080
```

**Warning:** Only use if your security group restricts access to your IP. Update the IP rule when your home IP changes.

---

## 9. Step 8 — Configure Local Machine

### Install Dependencies Locally

```bash
# Clone the repo (if not done)
git clone https://github.com/vellankikoti/kotg.git
cd kotg
git checkout claude/setup-local-ai-agent-PZaME

# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install KOTG.AI and dev dependencies
uv sync --extra dev

# Verify
uv run python -c "import kotg; print('KOTG.AI installed OK')"
```

### Configure .env for EC2 Backend

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# ── If using SSH tunnel (localhost forwarding) ────────────────────────────────
KOTG_OLLAMA_BASE_URL=http://localhost:11434
KOTG_QDRANT_URL=http://localhost:6333

# ── If using direct EC2 access ────────────────────────────────────────────────
# KOTG_OLLAMA_BASE_URL=http://<EC2_PUBLIC_IP>:11434
# KOTG_QDRANT_URL=http://<EC2_PUBLIC_IP>:6333

# ── Model configuration (matches what we pulled) ─────────────────────────────
KOTG_MODEL_NANO_MODEL=qwen2.5:0.5b
KOTG_MODEL_SMALL_MODEL=qwen2.5-coder:7b-instruct-q4_k_m
KOTG_MODEL_MEDIUM_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_LARGE_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_EXPERT_MODEL=qwen2.5:7b-instruct-q4_k_m
KOTG_MODEL_EMBEDDING_MODEL=nomic-embed-text

# ── Connection settings ───────────────────────────────────────────────────────
KOTG_OLLAMA_TIMEOUT=120
KOTG_OLLAMA_MAX_RETRIES=3

# ── Kubernetes (local kubeconfig for testing) ─────────────────────────────────
KOTG_KUBE_IN_CLUSTER=false
# KOTG_KUBE_CONFIG_PATH=~/.kube/config

# ── App settings ──────────────────────────────────────────────────────────────
KOTG_DEBUG=true
KOTG_LOG_LEVEL=DEBUG
KOTG_DATA_DIR=~/.kotg
KOTG_API_PORT=8080
```

---

## 10. Step 9 — Verify Everything Works

Run these checks from your **local machine** (with SSH tunnel active):

```bash
# 1. Ollama health check
curl http://localhost:11434/api/version
# Expected: {"version":"0.5.x"}

# 2. List available models
curl http://localhost:11434/api/tags | jq '.models[].name'
# Expected: "qwen2.5-coder:7b-instruct-q4_k_m", "qwen2.5:0.5b", "nomic-embed-text", ...

# 3. Ollama inference test
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:0.5b",
  "prompt": "What is Kubernetes in one sentence?",
  "stream": false
}' | jq '.response'
# Expected: A valid one-sentence answer about Kubernetes

# 4. Embedding test
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "kubernetes pod deployment"
}' | jq '.embedding | length'
# Expected: 768

# 5. Qdrant health check
curl http://localhost:6333/
# Expected: {"title":"qdrant - vector search engine",...}

# 6. KOTG.AI config test
cd /path/to/kotg
uv run python -c "
from kotg.core.config import get_settings
s = get_settings()
print(f'Ollama URL: {s.ollama.base_url}')
print(f'Small model: {s.models.small_model}')
print(f'Embedding model: {s.models.embedding_model}')
"

# 7. KOTG.AI LLM connectivity test
uv run python -c "
import asyncio
from kotg.core.llm import OllamaClient, ModelTier
from kotg.core.config import get_settings

async def test():
    client = OllamaClient(get_settings())
    response = await client.generate(
        model='qwen2.5:0.5b',
        prompt='Say: KOTG.AI connection test successful',
        max_tokens=50
    )
    print(response.content)

asyncio.run(test())
"

# 8. Run KOTG.AI unit tests
uv run pytest tests/core tests/mcp -v
# Expected: all tests pass
```

---

## 11. Step 10 — Run KOTG.AI APIs & MCPs

### Start the KOTG.AI API Server

```bash
# From your local machine (pointing to EC2 Ollama via tunnel)
cd /path/to/kotg

# Run the API server
uv run kotg serve
# Server starts at http://localhost:8080

# Or with explicit port
uv run uvicorn kotg.api.main:app --host 0.0.0.0 --port 8080 --reload
```

### Test API Endpoints

```bash
# Diagnose a Kubernetes issue
curl -X POST http://localhost:8080/api/v1/diagnose \
  -H "Content-Type: application/json" \
  -d '{
    "query": "My pod is in CrashLoopBackOff, what should I do?",
    "namespace": "default"
  }' | jq .

# Generate YAML
curl -X POST http://localhost:8080/api/v1/generate \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Create a deployment for nginx with 3 replicas, resource limits 100m CPU and 128Mi memory"
  }' | jq .

# Ask a general question
curl -X POST http://localhost:8080/api/v1/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Explain the difference between a Deployment and a StatefulSet"
  }' | jq .
```

### Test MCP Server

```bash
# Start KOTG.AI as an MCP server
uv run kotg mcp serve
# MCP server starts on stdio or HTTP depending on config

# Test MCP tool listing
uv run python -c "
from kotg.mcp.kubectl import build_kubectl_registry
registry = build_kubectl_registry()
tools = registry.to_llm_tools()
for tool in tools:
    print(f'Tool: {tool[\"function\"][\"name\"]} — {tool[\"function\"][\"description\"][:60]}')
"
```

### Use with Claude Desktop (MCP Integration)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "kotg": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/kotg", "kotg", "mcp", "serve"],
      "env": {
        "KOTG_OLLAMA_BASE_URL": "http://localhost:11434",
        "KOTG_MODEL_SMALL_MODEL": "qwen2.5-coder:7b-instruct-q4_k_m"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see KOTG.AI tools available in Claude's tool panel.

---

## 12. Cost Estimation

### Hourly Costs (us-east-1, on-demand)

| Instance       | $/hr    | 8hr day | 22-day month |
|----------------|---------|---------|--------------|
| g4dn.xlarge    | $0.526  | $4.21   | $92.57       |
| g4dn.xlarge    | ~$0.16  | $1.28   | $28.16       |
| (spot price)   |         |         |              |
| m5.2xlarge     | $0.384  | $3.07   | $67.58       |
| m5.2xlarge     | ~$0.12  | $0.96   | $21.12       |
| (spot price)   |         |         |              |

**EBS storage (200 GB gp3):** ~$16/month

**Recommendation:** Use **Spot instances** — save 60–70%. For dev work, interruptions are fine with tmux/screen sessions.

### Request Spot Instance

```bash
aws ec2 request-spot-instances \
  --spot-price "0.20" \
  --instance-count 1 \
  --type "one-time" \
  --launch-specification '{
    "ImageId": "'$AMI_ID'",
    "InstanceType": "g4dn.xlarge",
    "KeyName": "kotg-dev",
    "SecurityGroupIds": ["'$SG_ID'"],
    "SubnetId": "'$SUBNET_ID'",
    "BlockDeviceMappings": [{
      "DeviceName": "/dev/sda1",
      "Ebs": {"VolumeSize": 200, "VolumeType": "gp3", "DeleteOnTermination": true}
    }]
  }'
```

### Cost-Saving Tips

- **Stop** the instance when not developing: `aws ec2 stop-instances --instance-ids $INSTANCE_ID`
- Use a **launch template** to restart quickly without re-provisioning
- Models are cached on the EBS volume — no re-download after restart
- Keep an **Elastic IP** to avoid IP changes on restart (free while instance is running): `aws ec2 allocate-address`

---

## 13. Automated Bootstrap Script

Copy this script to EC2 and run it — it handles Steps 3–6 automatically.

**File: `scripts/ec2-setup.sh`** (see `scripts/` directory)

```bash
# On your local machine, copy and run:
scp -i ~/.ssh/kotg-dev.pem scripts/ec2-setup.sh ubuntu@<EC2_IP>:~/
ssh -i ~/.ssh/kotg-dev.pem ubuntu@<EC2_IP> "chmod +x ~/ec2-setup.sh && ~/ec2-setup.sh"

# Takes ~15-20 minutes for full setup + model downloads
# Watch progress:
ssh -i ~/.ssh/kotg-dev.pem ubuntu@<EC2_IP> "tail -f ~/kotg-setup.log"
```

---

## 14. Troubleshooting

### Ollama not responding

```bash
# Check service status
sudo systemctl status ollama

# Check logs
sudo journalctl -u ollama -n 50 --no-pager

# Restart
sudo systemctl restart ollama

# Verify binding
ss -tlnp | grep 11434
# Expected: LISTEN on 0.0.0.0:11434
```

### GPU not being used

```bash
# On EC2, check GPU status
nvidia-smi

# During model inference, watch GPU utilization
watch -n 1 nvidia-smi

# Check Ollama detects GPU
ollama run qwen2.5:0.5b "hi"
# Should show GPU memory usage in nvidia-smi

# Force GPU (if Ollama defaults to CPU)
CUDA_VISIBLE_DEVICES=0 ollama serve
```

### SSH Tunnel drops

```bash
# Use autossh for auto-reconnect
autossh -M 20000 -f -N \
  -L 11434:127.0.0.1:11434 \
  -L 6333:127.0.0.1:6333 \
  -L 8080:127.0.0.1:8080 \
  ubuntu@<EC2_IP> -i ~/.ssh/kotg-dev.pem

# Or add to ~/.ssh/config and use: autossh -M 0 -f -N kotg-dev
```

### Model out of memory (OOM)

```bash
# Check current VRAM usage
nvidia-smi

# Unload models not in use
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b-instruct-q4_k_m",
  "keep_alive": 0
}'

# Use smaller quantization
ollama pull qwen2.5-coder:7b-instruct-q4_0
# q4_0 is slightly smaller than q4_k_m

# Limit parallel models
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
EOF
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

### Qdrant connection refused

```bash
# Check if Docker container is running
docker ps | grep qdrant
docker logs qdrant

# Restart Qdrant
docker restart qdrant

# Check port binding
ss -tlnp | grep 6333
```

### IP changed after instance restart

```bash
# Get new IP
NEW_IP=$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)
echo "New IP: $NEW_IP"

# Update SSH config
sed -i "s/HostName .*/HostName $NEW_IP/" ~/.ssh/config

# Or: assign an Elastic IP (prevents IP change)
EIP=$(aws ec2 allocate-address --query 'AllocationId' --output text)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP
```

---

## Quick Reference

```bash
# ── One-time setup ────────────────────────────────────────────────────────────
ssh -i ~/.ssh/kotg-dev.pem ubuntu@<EC2_IP> "bash -s" < scripts/ec2-setup.sh

# ── Daily development workflow ────────────────────────────────────────────────

# 1. Start EC2 (if stopped)
aws ec2 start-instances --instance-ids $INSTANCE_ID

# 2. Get IP
PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# 3. Open SSH tunnel (keep running in background terminal)
autossh -M 0 -f -N kotg-dev   # or: ssh kotg-dev -N &

# 4. Develop locally (Ollama at localhost:11434 via tunnel)
cd /path/to/kotg
uv run pytest tests/ -v          # run tests
uv run kotg serve                # start API server
uv run kotg diagnose "pod crash" # test CLI

# 5. Stop EC2 when done (save money)
aws ec2 stop-instances --instance-ids $INSTANCE_ID
```

---

*Last updated: 2026-02-28 | KOTG.AI v0.1 Development Environment*
