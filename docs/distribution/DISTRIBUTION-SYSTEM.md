# Kubilitics Distribution System — Complete Design

**Version:** 1.0.0
**Last Updated:** 2026-03-17
**Status:** Production-ready

---

## Table of Contents

1. [Distribution Strategy Overview](#1-distribution-strategy-overview)
2. [macOS Distribution](#2-macos-distribution)
3. [Windows Distribution](#3-windows-distribution)
4. [Linux Distribution](#4-linux-distribution)
5. [kubectl Plugin Distribution](#5-kubectl-plugin-distribution)
6. [CI/CD Pipeline Design](#6-cicd-pipeline-design)
7. [Website Installation Page](#7-website-installation-page)
8. [Security & Verification](#8-security--verification)
9. [Repository Structure](#9-repository-structure)
10. [Production Readiness Checklist](#10-production-readiness-checklist)

---

## 1. Distribution Strategy Overview

### Philosophy

Kubilitics follows a **meet-users-where-they-are** distribution model. Every Kubernetes practitioner — from a solo developer on macOS to a platform team in an air-gapped datacenter — should be able to install Kubilitics in under 60 seconds using their preferred method.

### Distribution Matrix

| Channel | Artifact | Target Audience | Priority |
|---|---|---|---|
| **GitHub Releases** | Desktop installers + kcli binaries + checksums | All platforms | P0 (shipping) |
| **Homebrew** | `kcli` formula + `kubilitics` cask | macOS/Linux developers | P0 |
| **winget** | Desktop `.exe` installer | Windows developers | P1 |
| **Scoop** | `kcli` binary | Windows CLI users | P1 |
| **APT** | `.deb` packages | Debian/Ubuntu servers | P1 |
| **Docker / GHCR** | Backend + AI container images | Kubernetes deployments | P0 (shipping) |
| **Helm chart (OCI)** | In-cluster deployment | Platform teams | P0 (shipping) |
| **kubectl plugin (Krew)** | `kubectl kubilitics` | kubectl users | P2 |
| **curl | sh** | One-liner install script | Quick-start users | P1 |

### Artifact Naming Convention

```
kcli-v{VERSION}-{OS}-{ARCH}.tar.gz
Kubilitics-{VERSION}-universal.dmg
Kubilitics-{VERSION}-x64-setup.exe
Kubilitics-{VERSION}-x64.msi
kubilitics_{VERSION}_amd64.deb
kubilitics-{VERSION}.x86_64.rpm
kubilitics-{VERSION}.x86_64.AppImage
```

### Version Strategy

- **Semver:** `MAJOR.MINOR.PATCH` (e.g., `1.0.0`)
- **Pre-release:** `1.1.0-beta.1`, `1.1.0-rc.1`
- **Docker tags:** `1.0.0`, `1.0`, `1`, `latest`, `sha-{commit}`
- **Helm chart version:** Tracks app version (both `1.0.0`)

---

## 2. macOS Distribution

### 2.1 Homebrew (CLI — kcli)

**Tap repository:** `kubilitics/homebrew-tap`

```ruby
# Formula/kcli.rb
class Kcli < Formula
  desc "AI-powered kubectl replacement for Kubernetes management"
  homepage "https://kubilitics.com"
  version "1.0.0"
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

**Install commands:**
```bash
brew tap kubilitics/tap
brew install kubilitics/tap/kcli
```

### 2.2 Homebrew Cask (Desktop App)

```ruby
# Casks/kubilitics.rb
cask "kubilitics" do
  version "1.0.0"
  sha256 "PLACEHOLDER_SHA256_DMG"

  url "https://github.com/kubilitics/kubilitics/releases/download/v#{version}/Kubilitics-#{version}-universal.dmg"
  name "Kubilitics"
  desc "Kubernetes management platform with real-time dashboard"
  homepage "https://kubilitics.com"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Kubilitics.app"

  zap trash: [
    "~/Library/Application Support/com.kubilitics.app",
    "~/Library/Caches/com.kubilitics.app",
    "~/Library/Preferences/com.kubilitics.app.plist",
    "~/Library/Saved Application State/com.kubilitics.app.savedState",
  ]
end
```

**Install commands:**
```bash
brew install --cask kubilitics
```

### 2.3 Code Signing & Notarization

**Secrets required:**
| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application cert (.p12) |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 |
| `APPLE_SIGNING_IDENTITY` | e.g., "Developer ID Application: Kubilitics Inc (TEAMID)" |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

**Flow:**
1. Build universal binary (Intel + Apple Silicon via `lipo`)
2. Code sign with Developer ID Application certificate
3. Submit to Apple notarization service (`xcrun notarytool submit --wait`)
4. Staple notarization ticket (`xcrun stapler staple`)
5. Package into DMG

---

## 3. Windows Distribution

### 3.1 winget Manifest

**Repository:** `microsoft/winget-pkgs` (submit PR) or self-hosted manifest

```yaml
# manifests/k/Kubilitics/Kubilitics/1.0.0/Kubilitics.Kubilitics.yaml
PackageIdentifier: Kubilitics.Kubilitics
PackageVersion: 1.0.0
PackageLocale: en-US
Publisher: Kubilitics
PublisherUrl: https://kubilitics.com
PackageName: Kubilitics
PackageUrl: https://kubilitics.com
License: Apache-2.0
ShortDescription: Kubernetes management platform with real-time dashboard and AI-powered CLI
Description: |
  Kubilitics is a production-grade Kubernetes management platform.
  Features include real-time dashboards, dependency intelligence,
  multi-cluster management, Helm add-on platform, AI-powered CLI (kcli),
  and in-browser terminal access.
Tags:
  - kubernetes
  - k8s
  - devops
  - containers
  - dashboard
  - kubectl
Installers:
  - Architecture: x64
    InstallerType: nsis
    InstallerUrl: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/Kubilitics-1.0.0-x64-setup.exe
    InstallerSha256: PLACEHOLDER_SHA256
    UpgradeBehavior: install
ManifestType: singleton
ManifestVersion: 1.6.0
```

**Install commands:**
```powershell
winget install Kubilitics.Kubilitics
```

### 3.2 Scoop (CLI — kcli)

**Bucket repository:** `kubilitics/scoop-bucket`

```json
{
  "version": "1.0.0",
  "description": "AI-powered kubectl replacement for Kubernetes management",
  "homepage": "https://kubilitics.com",
  "license": "Apache-2.0",
  "architecture": {
    "64bit": {
      "url": "https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-windows-amd64.zip",
      "hash": "PLACEHOLDER_SHA256"
    }
  },
  "bin": "kcli.exe",
  "checkver": {
    "github": "https://github.com/kubilitics/kubilitics"
  },
  "autoupdate": {
    "architecture": {
      "64bit": {
        "url": "https://github.com/kubilitics/kubilitics/releases/download/v$version/kcli-v$version-windows-amd64.zip"
      }
    }
  }
}
```

**Install commands:**
```powershell
scoop bucket add kubilitics https://github.com/kubilitics/scoop-bucket
scoop install kubilitics/kubilitics-kcli
```

### 3.3 Windows Code Signing

**Secrets required:**
| Secret | Purpose |
|---|---|
| `WINDOWS_CERTIFICATE` | Base64-encoded code-signing cert (.pfx) |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the .pfx |

**Flow:**
1. Build NSIS installer + MSI via Tauri
2. Sign `.exe` and `.msi` with `signtool.exe`
3. Include signed installer in GitHub Release

---

## 4. Linux Distribution

### 4.1 APT Repository (Debian/Ubuntu)

**Repository URL:** `https://apt.kubilitics.io`

**Setup:**
```bash
# Add GPG key
curl -fsSL https://apt.kubilitics.io/gpg.key | \
  sudo gpg --dearmor -o /usr/share/keyrings/kubilitics.gpg

# Add repository
echo "deb [signed-by=/usr/share/keyrings/kubilitics.gpg] https://apt.kubilitics.io stable main" | \
  sudo tee /etc/apt/sources.list.d/kubilitics.list

# Install
sudo apt update && sudo apt install kubilitics
```

**Package variants:**
| Package | Contents |
|---|---|
| `kubilitics` | Desktop app (AppImage wrapper + .desktop entry) |
| `kubilitics-server` | Backend server binary + systemd service |
| `kcli` | CLI binary + shell completions |

### 4.2 RPM Repository (RHEL/Fedora)

**Repository URL:** `https://rpm.kubilitics.io`

**Setup:**
```bash
cat <<EOF | sudo tee /etc/yum.repos.d/kubilitics.repo
[kubilitics]
name=Kubilitics
baseurl=https://rpm.kubilitics.io/stable/\$basearch
gpgcheck=1
gpgkey=https://rpm.kubilitics.io/gpg.key
enabled=1
EOF

sudo dnf install kubilitics
```

### 4.3 Snap / Flatpak (Future)

Not prioritized for v1.0. Desktop app distributed via AppImage + DEB + RPM covers 95%+ of Linux users.

### 4.4 curl | sh One-Liner

**For kcli CLI only:**

```bash
curl -fsSL https://kubilitics.com/install.sh | sh
```

**Install script** (`scripts/install.sh`):
```bash
#!/bin/sh
set -e

REPO="kubilitics/kubilitics"
BINARY="kcli"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest version
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/')
if [ -z "$VERSION" ]; then
  echo "Failed to detect latest version"
  exit 1
fi

# Download and install
URL="https://github.com/$REPO/releases/download/v${VERSION}/${BINARY}-v${VERSION}-${OS}-${ARCH}.tar.gz"
echo "Installing $BINARY v$VERSION ($OS/$ARCH)..."
TMPDIR=$(mktemp -d)
curl -fsSL "$URL" | tar xz -C "$TMPDIR"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPDIR/$BINARY" "$INSTALL_DIR/$BINARY"
else
  sudo mv "$TMPDIR/$BINARY" "$INSTALL_DIR/$BINARY"
fi
chmod +x "$INSTALL_DIR/$BINARY"
rm -rf "$TMPDIR"

echo "✅ $BINARY v$VERSION installed to $INSTALL_DIR/$BINARY"
echo "   Run '$BINARY version' to verify."
```

---

## 5. kubectl Plugin Distribution

### 5.1 Krew Plugin

**Krew index manifest** (`plugins/kubilitics.yaml`):

```yaml
apiVersion: krew.googlecontainertools.github.com/v1alpha2
kind: Plugin
metadata:
  name: kubilitics
spec:
  version: v1.0.0
  homepage: https://kubilitics.com
  shortDescription: "Launch Kubilitics dashboard for your cluster"
  description: |
    Kubilitics is a production-grade Kubernetes management platform.
    This plugin launches the Kubilitics dashboard connected to your
    current kubectl context. Supports real-time monitoring, dependency
    intelligence, and AI-powered insights.
  platforms:
    - selector:
        matchLabels:
          os: darwin
          arch: amd64
      uri: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-darwin-amd64.tar.gz
      sha256: PLACEHOLDER
      bin: kcli
    - selector:
        matchLabels:
          os: darwin
          arch: arm64
      uri: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-darwin-arm64.tar.gz
      sha256: PLACEHOLDER
      bin: kcli
    - selector:
        matchLabels:
          os: linux
          arch: amd64
      uri: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-linux-amd64.tar.gz
      sha256: PLACEHOLDER
      bin: kcli
    - selector:
        matchLabels:
          os: linux
          arch: arm64
      uri: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-linux-arm64.tar.gz
      sha256: PLACEHOLDER
      bin: kcli
    - selector:
        matchLabels:
          os: windows
          arch: amd64
      uri: https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/kcli-v1.0.0-windows-amd64.zip
      sha256: PLACEHOLDER
      bin: kcli.exe
```

**Install commands:**
```bash
kubectl krew install kubilitics
kubectl kubilitics dashboard
```

### 5.2 Plugin Behavior

`kcli` already supports being invoked as a kubectl plugin when symlinked as `kubectl-kubilitics`:

```go
// kcli/internal/plugin/plugin.go
// When invoked as "kubectl kubilitics", kcli detects the plugin mode
// and adjusts its behavior (uses current kubeconfig context, etc.)
```

---

## 6. CI/CD Pipeline Design

### 6.1 Current Pipeline (Shipping)

The release pipeline (`.github/workflows/release.yml`) already handles:

```
Tag Push (v*)
├── frontend-dist       → Build React app (Tauri mode), shared artifact
├── kcli                → 5 platform binaries (parallel cross-compile)
├── docker-backend      → Multi-arch GHCR image (amd64 + arm64)
├── docker-ai           → GHCR image (amd64)
├── desktop (matrix)    → macOS DMG, Windows NSIS+MSI, Linux AppImage+DEB+RPM
│   ├── macos-latest    → Universal binary (lipo), code signing, notarization
│   ├── windows-latest  → x64 NSIS + MSI
│   └── ubuntu-latest   → x64 AppImage + DEB + RPM
└── release             → GitHub Release with checksums.txt
```

### 6.2 Post-Release Automation (To Implement)

Add a `post-release.yml` workflow that triggers after `release.yml` completes:

```yaml
name: Post-Release Distribution
on:
  workflow_run:
    workflows: ["Release"]
    types: [completed]
    branches: [main]

jobs:
  update-homebrew:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: Update Homebrew tap
        uses: mislav/bump-homebrew-formula-action@v3
        with:
          formula-name: kcli
          homebrew-tap: kubilitics/homebrew-tap
          tag-name: ${{ github.event.workflow_run.head_branch }}
          download-url: https://github.com/kubilitics/kubilitics/releases/download/${{ github.event.workflow_run.head_branch }}/kcli-*.tar.gz
        env:
          COMMITTER_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}

  update-scoop:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout scoop bucket
        uses: actions/checkout@v4
        with:
          repository: kubilitics/scoop-bucket
          token: ${{ secrets.SCOOP_BUCKET_TOKEN }}
      - name: Update manifest
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          # Update version and SHA in kcli.json
          # Script downloads release, computes SHA, updates JSON

  update-krew:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: Update Krew plugin manifest
        uses: rajatjindal/krew-release-bot@v0.0.46
        with:
          krew_template_file: .krew.yaml

  update-winget:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: Submit winget manifest
        uses: vedantmgoyal9/winget-releaser@v2
        with:
          identifier: Kubilitics.Kubilitics
          installers-regex: 'Kubilitics-.*-x64-setup\.exe$'
          token: ${{ secrets.WINGET_TOKEN }}
```

### 6.3 Helm Chart Publishing

Already handled in the Docker workflow. OCI push to GHCR:

```bash
helm push kubilitics-1.0.0.tgz oci://ghcr.io/kubilitics/charts
```

**Installation:**
```bash
helm install kubilitics oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 1.0.0 -n kubilitics --create-namespace
```

---

## 7. Website Installation Page

### 7.1 Design Requirements

The Installation section on kubilitics.com provides:

1. **Two-tab layout:** Desktop App vs. In-Cluster
2. **Desktop App tab:**
   - Platform-specific download buttons (macOS, Windows, Linux) with brand-colored OS icons
   - Detects user's OS and highlights the recommended download
   - Shows file type and architecture support
   - Package manager alternatives (Homebrew, winget, Scoop)
3. **In-Cluster tab:**
   - 3-step Helm deployment with copy-able commands
   - Team access callout
4. **CLI tab (to add):**
   - curl | sh one-liner
   - Homebrew / Scoop install
   - Docker run alternative

### 7.2 Implementation

See `website/components/Installation.tsx` — currently implements tabs for Desktop and In-Cluster.

**Enhancement:** Add a third "CLI (kcli)" tab with:
```
brew tap kubilitics/tap && brew install kcli    # macOS/Linux
scoop bucket add kubilitics ... && scoop install kcli  # Windows
curl -fsSL https://kubilitics.com/install.sh | sh     # Universal
```

---

## 8. Security & Verification

### 8.1 Checksum Verification

Every GitHub Release includes `checksums.txt` with SHA-256 hashes:

```
e3b0c44298fc...  Kubilitics-1.0.0-universal.dmg
a7ffc6f8bf1e...  Kubilitics-1.0.0-x64-setup.exe
...
```

**User verification:**
```bash
# Download checksum file
curl -fsSLO https://github.com/kubilitics/kubilitics/releases/download/v1.0.0/checksums.txt

# Verify
sha256sum -c checksums.txt --ignore-missing
```

### 8.2 GPG Signing (Future Enhancement)

Sign release artifacts with a project GPG key:

```bash
# Sign
gpg --detach-sign --armor checksums.txt

# Verify
curl -fsSLO https://kubilitics.com/gpg.key
gpg --import gpg.key
gpg --verify checksums.txt.asc checksums.txt
```

### 8.3 SBOM (Software Bill of Materials)

Generate SBOM for Docker images using Syft:

```bash
syft ghcr.io/kubilitics/kubilitics-backend:1.0.0 -o spdx-json > sbom.spdx.json
```

Attach to GitHub Release as an additional artifact.

### 8.4 Container Image Scanning

Already configured in `security-scan.yml`:
- **Trivy:** Scans Docker images for CVEs
- **govulncheck:** Scans Go dependencies

### 8.5 Supply Chain Security

| Control | Status |
|---|---|
| Pinned GitHub Actions versions | ✅ |
| Signed commits on main | ✅ |
| Branch protection on main | ✅ |
| GITHUB_TOKEN (no PAT for releases) | ✅ |
| Checksum file in releases | ✅ |
| SLSA provenance (Docker) | Planned |
| Sigstore/cosign image signing | Planned |

---

## 9. Repository Structure

### 9.1 Distribution-Related Files

```
kubilitics-os-emergent/
├── .github/
│   └── workflows/
│       ├── release.yml                  # Main release pipeline (shipping)
│       ├── post-release.yml             # Auto-update package managers
│       ├── security-scan.yml            # Trivy + govulncheck
│       └── website.yml                  # Website deployment
├── deploy/
│   ├── helm/kubilitics/                 # Helm chart (shipping)
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   └── deb/                             # Debian package scaffolding
│       ├── control
│       ├── postinst
│       ├── prerm
│       └── kubilitics.service
├── docs/
│   ├── DISTRIBUTION.md                  # Distribution overview
│   ├── RELEASE-STANDARDS.md             # Release gate checklist
│   ├── release-steps.md                 # Step-by-step release runbook
│   └── distribution/
│       ├── packaging-guide.md           # Homebrew/APT/Docker/Helm details
│       └── DISTRIBUTION-SYSTEM.md       # This document
├── scripts/
│   ├── install.sh                       # curl | sh installer for kcli
│   └── update-homebrew.sh              # Homebrew formula update helper
├── packaging/
│   ├── homebrew/
│   │   ├── kcli.rb                      # Homebrew formula template
│   │   └── kubilitics.rb                # Homebrew cask template
│   ├── winget/
│   │   └── Kubilitics.Kubilitics.yaml   # winget manifest template
│   ├── scoop/
│   │   └── kcli.json                    # Scoop manifest template
│   └── krew/
│       └── kubilitics.yaml              # Krew plugin manifest
└── website/
    └── components/
        └── Installation.tsx             # Website install page
```

### 9.2 External Repositories (To Create)

| Repository | Purpose |
|---|---|
| `kubilitics/homebrew-tap` | Homebrew tap (formula + cask) |
| `kubilitics/scoop-bucket` | Scoop bucket for Windows |

---

## 10. Production Readiness Checklist

### Pre-Launch (Before v1.0.0 Public Release)

#### Build & CI
- [x] Release workflow builds all platforms (macOS, Windows, Linux)
- [x] kcli cross-compiled for 5 targets
- [x] Docker images pushed to GHCR (multi-arch)
- [x] Helm chart packaged and publishable to OCI
- [x] Frontend built once, shared across desktop platforms
- [x] Checksums generated for all release assets
- [x] Desktop builds include code signing support (macOS + Windows)
- [x] macOS notarization step included

#### Package Managers
- [ ] Create `kubilitics/homebrew-tap` repository
- [ ] Submit initial Homebrew formula PR
- [ ] Create `kubilitics/scoop-bucket` repository
- [ ] Prepare winget manifest for submission
- [ ] Create Krew plugin manifest
- [ ] Implement `scripts/install.sh` one-liner
- [ ] Set up post-release automation workflow

#### Security
- [x] SHA-256 checksums in every release
- [x] Trivy scanning on Docker images
- [x] govulncheck in pre-release gate
- [ ] GPG signing of release artifacts
- [ ] Cosign signing of container images
- [ ] SBOM generation and attachment

#### Website
- [x] Installation section with Desktop + In-Cluster tabs
- [x] Platform-specific download buttons with OS icons
- [x] Copy-able code blocks for CLI commands
- [ ] Add CLI (kcli) tab to Installation section
- [ ] OS auto-detection for recommended download
- [ ] Download count badges
- [ ] Version display from GitHub API

#### Documentation
- [x] DISTRIBUTION.md — channel overview
- [x] packaging-guide.md — Homebrew/APT/Docker/Helm templates
- [x] RELEASE-STANDARDS.md — comprehensive release gate
- [x] release-steps.md — step-by-step runbook
- [x] DISTRIBUTION-SYSTEM.md — this document

#### Testing
- [ ] Verify Homebrew formula installs cleanly on macOS
- [ ] Verify Homebrew formula installs cleanly on Linux
- [ ] Verify winget install on Windows 10+
- [ ] Verify Scoop install on Windows
- [ ] Verify APT install on Ubuntu 22.04/24.04
- [ ] Verify DEB install on Debian 12
- [ ] Verify RPM install on Fedora 39+
- [ ] Verify AppImage runs on Ubuntu/Fedora
- [ ] Verify Helm chart deploys on kind/minikube
- [ ] Verify Helm chart deploys on EKS/GKE/AKS
- [ ] Verify curl | sh installs on macOS/Linux
- [ ] Verify Docker image runs standalone
- [ ] Verify Krew plugin installs and launches

---

## Appendix: Quick Reference

### Install Kubilitics (All Methods)

```bash
# macOS — Desktop App
brew install --cask kubilitics

# macOS/Linux — CLI only
brew tap kubilitics/tap && brew install kcli

# Windows — Desktop App
winget install Kubilitics.Kubilitics

# Windows — CLI only
scoop bucket add kubilitics https://github.com/kubilitics/scoop-bucket
scoop install kcli

# Linux — Desktop App
# Download from https://github.com/kubilitics/kubilitics/releases

# Linux — CLI only (Debian/Ubuntu)
curl -fsSL https://apt.kubilitics.io/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/kubilitics.gpg
echo "deb [signed-by=/usr/share/keyrings/kubilitics.gpg] https://apt.kubilitics.io stable main" | sudo tee /etc/apt/sources.list.d/kubilitics.list
sudo apt update && sudo apt install kcli

# Universal — CLI only (curl)
curl -fsSL https://kubilitics.com/install.sh | sh

# Kubernetes — In-Cluster
helm install kubilitics oci://ghcr.io/kubilitics/charts/kubilitics \
  --version 1.0.0 -n kubilitics --create-namespace

# kubectl plugin
kubectl krew install kubilitics
kubectl kubilitics dashboard

# Docker
docker run -p 8080:8080 ghcr.io/kubilitics/kubilitics-backend:1.0.0
```
