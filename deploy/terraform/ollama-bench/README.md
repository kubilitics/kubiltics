# Ollama bench VM (AWS, Terraform + Make)

Provisions a single AWS EC2 GPU instance running Ollama with one or more
models pre-pulled, for benchmarking the **kubilitics-ai** brain against
real LLM backends.

## What you get

- 1x EC2 instance — default `g5.xlarge` (NVIDIA A10G, 24 GB VRAM, 16 GB RAM, 4 vCPU)
- Ubuntu 22.04 LTS + NVIDIA drivers (auto-installed via `ubuntu-drivers autoinstall`)
- Ollama installed, listening on `0.0.0.0:11434`
- Default model: `qwen2.5-coder:7b` (override via `models = [...]`)
- 60 GB gp3 EBS root (room for multiple 5–15 GB models)
- Elastic IP (stable across stop/start)
- Security group locked to **your current public IP only** (auto-detected)
- Fresh SSH keypair written to `bench-key.pem` (chmod 0600, gitignored)

## Cost

| State              | Approx cost (us-east-1) |
|--------------------|-------------------------|
| `g5.xlarge` running | ~$1.00 / hr             |
| Stopped (EBS only)  | ~$0.005 / hr ≈ $3 / mo  |
| EIP attached        | $0 (free while attached) |

**Lifecycle:** `make stop` after every session, `make start` to resume.
The EBS volume preserves Ollama + pulled models — no re-pull on resume.

## Prerequisites

- Terraform >= 1.5
- AWS CLI v2 (for `make stop` / `make start` / `make status`)
- AWS credentials configured (env vars or `~/.aws/credentials`)
- An AWS account with quota for `g5.xlarge` in your region (request via Service Quotas if first-time GPU usage)

## Quick start

```bash
cp terraform.tfvars.example terraform.tfvars   # optional — defaults are fine
make init
make up                # apply ~2 min, then bootstrap runs in background
make wait-ready        # SSH-polls until model pull finishes (~5–10 min)
make endpoint          # prints http://<EIP>:11434
```

## Pointing kubilitics-ai at it

```bash
URL=$(make -s -C deploy/terraform/ollama-bench endpoint)

# In your kubilitics-ai-server env:
export KUBILITICS_AI_LLM_PROVIDER=ollama
export KUBILITICS_AI_LLM_OLLAMA_BASE_URL="$URL"

# Run the bench harness:
cd kubilitics-ai/cmd/bench
./bench -tag ollama-qwen-7b -base "$URL"
```

## Cost lifecycle

```bash
make stop      # after each session — drops cost from ~$1/hr to ~$3/mo
make start     # resume; same EIP, same model, ready in ~30s
make status    # see state + bootstrap log tail
```

## Adding more models

```bash
make pull MODEL=llama3.1:8b
make pull MODEL=mistral:7b
make models    # ollama list
```

To bake them in for fresh provisions, also update `models` in `terraform.tfvars`.

## Swapping instance type

| Use case            | Variable                      |
|---------------------|-------------------------------|
| GPU default (A10G)  | `instance_type = "g5.xlarge"` |
| More headroom       | `instance_type = "g5.2xlarge"`|
| CPU-only fallback   | `instance_type = "t3.xlarge"` |

The bootstrap script auto-detects NVIDIA presence (`lspci | grep -i nvidia`)
and only installs drivers + reboots when GPU is present.

## Full teardown

```bash
make destroy   # wipes VM + EBS + pulled models. Re-run `make up` to start fresh.
```

## Security notes

- SG ingress is locked to **`<your-current-public-IP>/32`** for ports 22 + 11434.
- Auto-detection uses `https://checkip.amazonaws.com` at plan time.
- If your IP changes (new café, new VPN), re-run `make up` — the SG updates in place, no instance recreate.
- Override with `allowed_cidr = "x.x.x.x/32"` in `terraform.tfvars` if you want to pin manually.
- Ollama has no built-in auth; the IP-locked SG is your only gate. Don't widen it.

## Files

| File                   | Purpose                                          |
|------------------------|--------------------------------------------------|
| `versions.tf`          | Terraform + provider version pins                |
| `variables.tf`         | All tunable inputs                               |
| `main.tf`              | Provider + IP auto-detect                        |
| `network.tf`           | Default VPC lookup + Security Group              |
| `compute.tf`           | AMI lookup + EC2 + EIP + association             |
| `keys.tf`              | TLS keypair + local PEM file                     |
| `user-data.sh.tftpl`   | Bootstrap (drivers, Ollama, model pull)          |
| `outputs.tf`           | `instance_id`, `public_ip`, `ollama_url`, etc.   |
| `Makefile`             | `up`/`stop`/`start`/`pull`/`destroy` lifecycle   |

## AMI choice

Vanilla **Ubuntu 22.04 LTS** (Canonical owner `099720109477`) is used for
both CPU and GPU instances. NVIDIA drivers are installed conditionally by
`user-data.sh.tftpl` via `ubuntu-drivers autoinstall`, with a single reboot
gated by a sentinel file and a one-shot systemd unit that resumes the
bootstrap post-reboot. Tradeoff: ~3 min extra on first boot for GPU
instances vs. an NVIDIA-pre-baked AMI; benefit: one AMI lookup works for
every supported instance type, and the lockfile pin is simpler.
