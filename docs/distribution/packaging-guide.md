# Packaging and Distribution Guide

**Audience:** Release engineers, maintainers
**Applies to:** Kubilitics v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Homebrew Formula](#2-homebrew-formula)
3. [APT Package (Debian/Ubuntu)](#3-apt-package-debianubuntu)
4. [Docker Hub Image](#4-docker-hub-image)
5. [Helm Chart Publishing](#5-helm-chart-publishing)
6. [Release Automation](#6-release-automation)

---

## 1. Overview

Kubilitics is distributed through multiple channels to serve different deployment targets:

| Channel | Artifact | Target |
|---|---|---|
| Homebrew | `kcli` binary | macOS and Linux developers |
| APT | `.deb` package | Ubuntu/Debian servers |
| Docker Hub | Container image | Kubernetes / Docker deployments |
| Helm chart | OCI chart | Kubernetes cluster deployments |
| GitHub Releases | Binaries + desktop installers | All platforms |

### Naming Conventions

| Artifact | Name | Example |
|---|---|---|
| CLI binary | `kcli` | `kcli-v0.1.1-darwin-arm64.tar.gz` |
| Backend binary | `kubilitics-server` | `kubilitics-server-v0.1.1-linux-amd64.tar.gz` |
| Docker image | `kubilitics/kubilitics` | `kubilitics/kubilitics:0.1.1` |
| Helm chart | `kubilitics` | `oci://ghcr.io/kubilitics/charts/kubilitics:0.1.1` |
| Desktop (macOS) | `Kubilitics` | `Kubilitics-0.1.1-universal.dmg` |
| Desktop (Windows) | `Kubilitics` | `Kubilitics-0.1.1-x64.msi` |
| Desktop (Linux) | `kubilitics` | `kubilitics_0.1.1_amd64.deb` |

---

## 2. Homebrew Formula

### Formula Location

Host the formula in a custom tap repository: `kubilitics/homebrew-tap`.

### Formula Definition

```ruby
# Formula/kcli.rb
class Kcli < Formula
  desc "AI-powered kubectl replacement for Kubernetes management"
  homepage "https://github.com/kubilitics/kubilitics"
  version "0.1.1"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/kubilitics/kubilitics/releases/download/v#{version}/kcli-v#{version}-darwin-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"
    end
    on_intel do
      url "https://github.com/kubilitics/kubilitics/releases/download/v#{version}/kcli-v#{version}-darwin-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_DARWIN_AMD64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/kubilitics/kubilitics/releases/download/v#{version}/kcli-v#{version}-linux-arm64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/kubilitics/kubilitics/releases/download/v#{version}/kcli-v#{version}-linux-amd64.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_AMD64"
    end
  end

  def install
    bin.install "kcli"
    generate_completions_from_executable(bin/"kcli", "completion")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kcli version")
  end
end
```

### Installation

```bash
brew tap kubilitics/tap
brew install kubilitics/tap/kcli
brew upgrade kubilitics/tap/kcli
```

---

## 3. APT Package (Debian/Ubuntu)

### Package Structure

```
kubilitics-server_0.1.1_amd64/
├── DEBIAN/
│   ├── control
│   ├── postinst
│   └── prerm
├── usr/bin/kubilitics-server
├── etc/kubilitics/config.yaml
└── lib/systemd/system/kubilitics.service
```

### Control File

```
Package: kubilitics-server
Version: 0.1.1
Section: admin
Priority: optional
Architecture: amd64
Depends: libc6 (>= 2.31)
Maintainer: Kubilitics Team <team@kubilitics.io>
Description: Kubernetes management platform backend
 Kubilitics is a production-grade Kubernetes management platform with
 topology visualization, add-on management, and AI-powered insights.
Homepage: https://github.com/kubilitics/kubilitics
```

### Systemd Service

```ini
[Unit]
Description=Kubilitics Backend Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kubilitics
Group=kubilitics
ExecStart=/usr/bin/kubilitics-server --config /etc/kubilitics/config.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
EnvironmentFile=-/etc/default/kubilitics

[Install]
WantedBy=multi-user.target
```

### Building the .deb Package

```bash
cd kubilitics-backend
GOOS=linux GOARCH=amd64 CGO_ENABLED=1 go build -o kubilitics-server ./cmd/server

mkdir -p pkg/DEBIAN pkg/usr/bin pkg/etc/kubilitics pkg/lib/systemd/system
cp kubilitics-server pkg/usr/bin/
cp deploy/deb/control pkg/DEBIAN/
cp deploy/deb/kubilitics.service pkg/lib/systemd/system/
cp deploy/deb/config.yaml pkg/etc/kubilitics/

dpkg-deb --build pkg kubilitics-server_0.1.1_amd64.deb
```

### APT Repository Setup

Users add the repository:

```bash
curl -fsSL https://apt.kubilitics.io/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/kubilitics.gpg
echo "deb [signed-by=/usr/share/keyrings/kubilitics.gpg] https://apt.kubilitics.io stable main" | \
  sudo tee /etc/apt/sources.list.d/kubilitics.list
sudo apt update && sudo apt install kubilitics-server
```

---

## 4. Docker Hub Image

### Image Tags

| Tag | Description | Example |
|---|---|---|
| `X.Y.Z` | Immutable release tag | `kubilitics/kubilitics:0.1.1` |
| `X.Y` | Latest patch in minor | `kubilitics/kubilitics:0.1` |
| `latest` | Latest stable release | `kubilitics/kubilitics:latest` |
| `sha-abc1234` | Git commit SHA | `kubilitics/kubilitics:sha-7f14891` |

### Multi-Architecture Build

```bash
docker buildx create --use --name kubilitics-builder

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t kubilitics/kubilitics:0.1.1 \
  -t kubilitics/kubilitics:latest \
  --push \
  -f kubilitics-backend/Dockerfile \
  kubilitics-backend/
```

### Image Scanning

```bash
trivy image kubilitics/kubilitics:0.1.1
trivy image --exit-code 1 --severity CRITICAL kubilitics/kubilitics:0.1.1
```

---

## 5. Helm Chart Publishing

### Chart Location

The Helm chart is at `deploy/helm/kubilitics/`.

### Publishing to OCI Registry (GHCR)

```bash
helm package deploy/helm/kubilitics/ --version 0.1.1 --app-version 0.1.1

echo $GITHUB_TOKEN | helm registry login ghcr.io -u kubilitics --password-stdin
helm push kubilitics-0.1.1.tgz oci://ghcr.io/kubilitics/charts
```

### Installation from OCI

```bash
helm install kubilitics oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 0.1.1 \
  -n kubilitics --create-namespace
```

### Chart Testing

```bash
helm lint deploy/helm/kubilitics/
helm template kubilitics deploy/helm/kubilitics/ -f values-test.yaml
```

---

## 6. Release Automation

### GitHub Actions Release Workflow

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build-binaries:
    strategy:
      matrix:
        include:
          - { os: ubuntu-latest, goos: linux, goarch: amd64 }
          - { os: ubuntu-latest, goos: linux, goarch: arm64 }
          - { os: macos-latest, goos: darwin, goarch: amd64 }
          - { os: macos-latest, goos: darwin, goarch: arm64 }
          - { os: windows-latest, goos: windows, goarch: amd64 }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25.7'
      - name: Build kcli
        run: |
          GOOS=${{ matrix.goos }} GOARCH=${{ matrix.goarch }} \
          go build -ldflags="-s -w -X main.version=${{ github.ref_name }}" \
          -o kcli${{ matrix.goos == 'windows' && '.exe' || '' }} ./cmd/kcli
        working-directory: kcli

  docker-image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: kubilitics-backend
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            kubilitics/kubilitics:${{ github.ref_name }}
            kubilitics/kubilitics:latest

  helm-chart:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Package and push Helm chart
        run: |
          helm package deploy/helm/kubilitics/ \
            --version ${GITHUB_REF_NAME#v} --app-version ${GITHUB_REF_NAME#v}
          echo ${{ secrets.GITHUB_TOKEN }} | helm registry login ghcr.io -u kubilitics --password-stdin
          helm push kubilitics-*.tgz oci://ghcr.io/kubilitics/charts
```

### Release Checklist

1. [ ] All CI checks pass on `main`
2. [ ] `govulncheck ./...` passes in `kubilitics-backend`
3. [ ] Version bumped in `kubilitics-frontend/package.json`
4. [ ] `CHANGELOG.md` updated
5. [ ] Pre-release commands pass (see `docs/RELEASE-STANDARDS.md`)
6. [ ] Tag created: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
7. [ ] Tag pushed: `git push origin vX.Y.Z`
8. [ ] GitHub Actions release workflow completes
9. [ ] Docker Hub image verified
10. [ ] Helm chart verified
11. [ ] Homebrew formula updated
