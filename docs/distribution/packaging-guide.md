# Distribution Packages Guide

## Overview

This guide covers packaging and distributing Kubilitics components:

1. **kcli** — Homebrew formula, APT package
2. **kubilitics-backend** — Docker Hub image
3. **kubilitics Helm chart** — Public Helm repository

## 1. Homebrew Formula for kcli

### Formula Template

Create `Formula/kcli.rb`:

```ruby
class Kcli < Formula
  desc "AI-powered kubectl CLI replacement from Kubilitics"
  homepage "https://github.com/kubilitics/kubiltics"
  version "0.1.1"
  license "Apache-2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    else
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-darwin-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_AMD64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    else
      url "https://github.com/kubilitics/kubiltics/releases/download/v#{version}/kcli-linux-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_AMD64"
    end
  end

  def install
    bin.install "kcli"
    # Install shell completions
    generate_completions_from_executable(bin/"kcli", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kcli version")
  end
end
```

### Publishing to Homebrew Tap

1. Create a tap repository: `github.com/kubilitics/homebrew-tap`
2. Place the formula in `Formula/kcli.rb`
3. Users install via:

```bash
brew tap kubilitics/tap
brew install kcli
```

### Automation

Add to the release workflow (`.github/workflows/release.yml`):

```yaml
- name: Update Homebrew formula
  env:
    HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
  run: |
    # Calculate SHA256 for each archive
    for arch in darwin-arm64 darwin-amd64 linux-arm64 linux-amd64; do
      sha=$(shasum -a 256 dist/kcli-${arch}.tar.gz | awk '{print $1}')
      echo "SHA_${arch//-/_}=${sha}" >> $GITHUB_ENV
    done
    # Update formula via PR to tap repo
```

## 2. APT Package for kcli

### Package Structure

```
kcli_0.1.1_amd64/
├── DEBIAN/
│   ├── control
│   ├── postinst
│   └── prerm
└── usr/
    └── local/
        └── bin/
            └── kcli
```

### Control File

```
Package: kcli
Version: 0.1.1
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Kubilitics Team <team@kubilitics.dev>
Description: AI-powered kubectl CLI replacement
 kcli provides an intelligent command-line interface for Kubernetes
 cluster management, powered by LLM-based natural language processing.
Depends: libc6
Homepage: https://github.com/kubilitics/kubiltics
```

### Build Script

```bash
#!/bin/bash
set -euo pipefail

VERSION="${1:-0.1.1}"
ARCH="${2:-amd64}"

PKG_DIR="kcli_${VERSION}_${ARCH}"
mkdir -p "${PKG_DIR}/DEBIAN"
mkdir -p "${PKG_DIR}/usr/local/bin"

# Copy binary
cp "dist/kcli-linux-${ARCH}" "${PKG_DIR}/usr/local/bin/kcli"
chmod 755 "${PKG_DIR}/usr/local/bin/kcli"

# Create control file
cat > "${PKG_DIR}/DEBIAN/control" << EOF
Package: kcli
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: Kubilitics Team <team@kubilitics.dev>
Description: AI-powered kubectl CLI replacement
 kcli provides an intelligent command-line interface for Kubernetes
 cluster management.
Depends: libc6
Homepage: https://github.com/kubilitics/kubiltics
EOF

# Build .deb
dpkg-deb --build "${PKG_DIR}"
echo "Built: ${PKG_DIR}.deb"
```

### APT Repository Hosting

Host on GitHub Releases or a dedicated APT repository (e.g., Cloudsmith, Packagecloud):

```bash
# Users add the repo
curl -fsSL https://apt.kubilitics.dev/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/kubilitics.gpg
echo "deb [signed-by=/usr/share/keyrings/kubilitics.gpg] https://apt.kubilitics.dev stable main" | \
  sudo tee /etc/apt/sources.list.d/kubilitics.list
sudo apt update
sudo apt install kcli
```

## 3. Docker Hub Image

### Build Workflow

Add to `.github/workflows/docker-publish.yml`:

```yaml
name: Docker Publish
on:
  push:
    tags: ['v*']

env:
  REGISTRY: docker.io
  IMAGE_NAME: kubilitics/kubilitics-backend

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Extract version from tag
        id: version
        run: echo "VERSION=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: kubilitics-backend/Dockerfile
          push: true
          platforms: linux/amd64,linux/arm64
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.version.outputs.VERSION }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            GO_VERSION=1.25.7
            ALPINE_VERSION=3.21
```

### Manual Build and Push

```bash
cd kubilitics-backend

# Build multi-arch image
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag kubilitics/kubilitics-backend:0.1.1 \
  --tag kubilitics/kubilitics-backend:latest \
  --push \
  -f Dockerfile .
```

## 4. Helm Chart Publishing

### Chart Repository Setup

Use GitHub Pages or an OCI registry for Helm chart hosting.

#### Option A: GitHub Pages

1. Create `gh-pages` branch in the repo
2. Package and index the chart:

```bash
# Package the chart
helm package kubilitics-backend/chart/ -d docs/charts/

# Update index
helm repo index docs/charts/ --url https://kubilitics.github.io/kubiltics/charts
```

3. Configure GitHub Pages to serve from `docs/charts/`

Users install via:

```bash
helm repo add kubilitics https://kubilitics.github.io/kubiltics/charts
helm repo update
helm install kubilitics kubilitics/kubilitics --namespace kubilitics --create-namespace
```

#### Option B: OCI Registry (Docker Hub or GHCR)

```bash
# Package
helm package kubilitics-backend/chart/

# Push to OCI registry
helm push kubilitics-0.1.1.tgz oci://registry-1.docker.io/kubilitics
```

Users install via:

```bash
helm install kubilitics oci://registry-1.docker.io/kubilitics/kubilitics --version 0.1.1
```

### Chart CI Validation

Add to `.github/workflows/helm-lint.yml`:

```yaml
name: Helm Lint
on:
  pull_request:
    paths: ['kubilitics-backend/chart/**']

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - run: helm lint kubilitics-backend/chart/
      - run: helm template kubilitics kubilitics-backend/chart/ --values kubilitics-backend/chart/values.yaml
```

## Version Alignment

All distribution packages must track the same version:

- Git tag: `v0.1.1`
- Docker image tag: `0.1.1`
- Helm chart version: `0.1.1`
- Homebrew formula version: `0.1.1`
- APT package version: `0.1.1`
- `kubilitics-frontend/package.json` version: `0.1.1`

Update all in the same release commit. See `docs/release-steps.md` for the full checklist.
