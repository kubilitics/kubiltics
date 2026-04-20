# Ollama bench VM (AWS, Terraform + Make)

Provisions a single AWS EC2 instance running Ollama with one or more
models pre-pulled, for benchmarking the **kubilitics-ai** brain against
real LLM backends. CPU-only by default for cost; flip to GPU when you
need production-speed iteration.

## What you get

- 1x EC2 instance — default `t3.large` (2 vCPU, 8 GiB RAM, **CPU-only**)
- Ubuntu 22.04 LTS; NVIDIA drivers auto-installed only when a GPU instance is selected
- Ollama installed, listening on `0.0.0.0:11434`
- Default model: `qwen2.5:3b` (~2 GB; snappy on CPU; strong technical reasoning)
- 30 GB gp3 EBS root (~3 small models + system; bump to 60 for 7B+)
- Elastic IP (stable across stop/start)
- Security group locked to **your current public IP only** (auto-detected)
- Fresh SSH keypair written to `bench-key.pem` (chmod 0600, gitignored)

## Cost

| Instance               | Running           | Stopped (EBS only)         |
|------------------------|-------------------|----------------------------|
| `t3.large` (default)   | **~$0.083 / hr**  | ~$0.004 / hr ≈ $2.50 / mo  |
| `t3.xlarge` (16 GiB)   | ~$0.166 / hr      | same                       |
| `g5.xlarge` (GPU)      | ~$1.00 / hr       | same                       |
| EIP attached           | $0 (free while attached) | $0                  |

**Lifecycle:** `make stop` after every session, `make start` to resume.
The EBS volume preserves Ollama + pulled models — no re-pull on resume.

## Prerequisites

- Terraform >= 1.5
- AWS CLI v2 (for `make stop` / `make start` / `make status`)
- AWS credentials configured (env vars or `~/.aws/credentials`)
- A GPU instance (`g5.*`) requires a one-time Service Quota request if you've never launched GPU before; CPU instances need no extra quota.

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
./bench -tag ollama-qwen-3b -base "$URL"
```

## Cost lifecycle

```bash
make stop      # after each session — drops compute cost to $0; only ~$2.50/mo EBS remains
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

| Use case                       | Variable                      |
|--------------------------------|-------------------------------|
| CPU-only default (3B models)   | `instance_type = "t3.large"`  |
| CPU + headroom (7B models)     | `instance_type = "t3.xlarge"` |
| GPU (production-speed)         | `instance_type = "g5.xlarge"` |
| GPU + more VRAM                | `instance_type = "g5.2xlarge"`|

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
