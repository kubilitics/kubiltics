#!/usr/bin/env bash
# fetch-kcli.sh — Download or build kcli binary from https://github.com/vellankikoti/kcli
# Places the binary in kubilitics-desktop/src-tauri/binaries/ with proper Tauri target-triple naming.
#
# Usage:
#   ./scripts/fetch-kcli.sh                  # auto-detect OS/arch, download release
#   ./scripts/fetch-kcli.sh --build          # build from source via go install
#   ./scripts/fetch-kcli.sh --version v0.5.0 # pin a specific release version
#   KCLI_VERSION=v0.5.0 ./scripts/fetch-kcli.sh
#
# Environment variables:
#   KCLI_VERSION   — release tag to download (default: latest)
#   KCLI_REPO      — GitHub repo (default: vellankikoti/kcli)
#   KCLI_BUILD     — set to "1" to build from source instead of downloading

set -euo pipefail

KCLI_REPO="${KCLI_REPO:-vellankikoti/kcli}"
KCLI_VERSION="${KCLI_VERSION:-latest}"
KCLI_BUILD="${KCLI_BUILD:-0}"
BINARIES_DIR="kubilitics-desktop/src-tauri/binaries"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --build)     KCLI_BUILD=1 ;;
    --version=*) KCLI_VERSION="${arg#--version=}" ;;
    --version)   shift; KCLI_VERSION="${2:-latest}" ;;
  esac
done

# --- Detect platform ---
detect_platform() {
  local os arch vendor os_suffix target_triple

  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) vendor="apple"; os_suffix="darwin" ;;
    linux)  vendor="unknown"; os_suffix="linux-gnu" ;;
    *)      echo "ERROR: Unsupported OS: $os" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="x86_64" ;;
    arm64|aarch64) arch="aarch64" ;;
    *)             echo "ERROR: Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  target_triple="${arch}-${vendor}-${os_suffix}"
  echo "$target_triple"
}

# --- Resolve latest release version ---
resolve_version() {
  if [ "$KCLI_VERSION" = "latest" ]; then
    echo "Resolving latest kcli release..." >&2
    KCLI_VERSION=$(curl -sS "https://api.github.com/repos/${KCLI_REPO}/releases/latest" \
      | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')
    if [ -z "$KCLI_VERSION" ]; then
      echo "ERROR: Could not resolve latest release version. Set KCLI_VERSION explicitly." >&2
      exit 1
    fi
    echo "Latest version: $KCLI_VERSION" >&2
  fi
  echo "$KCLI_VERSION"
}

# --- Download release binary ---
download_release() {
  local triple="$1"
  local version="$2"
  local dest="$3"

  # Map target triple to GitHub release asset naming
  local os arch asset_name
  case "$triple" in
    *apple-darwin)  os="darwin" ;;
    *linux-gnu)     os="linux" ;;
  esac
  case "$triple" in
    x86_64-*)  arch="amd64" ;;
    aarch64-*) arch="arm64" ;;
  esac

  # GitHub releases typically use: kcli_<version>_<os>_<arch>.tar.gz or kcli-<os>-<arch>
  # Try common naming patterns
  local base_url="https://github.com/${KCLI_REPO}/releases/download/${version}"
  local version_stripped="${version#v}"  # strip leading 'v'

  local patterns=(
    "kcli_${version_stripped}_${os}_${arch}.tar.gz"
    "kcli_${version_stripped}_${os}_${arch}"
    "kcli-${os}-${arch}.tar.gz"
    "kcli-${os}-${arch}"
  )

  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT

  for pattern in "${patterns[@]}"; do
    local url="${base_url}/${pattern}"
    echo "Trying: ${url}" >&2
    if curl -sSL --fail -o "${tmpdir}/download" "$url" 2>/dev/null; then
      echo "Downloaded: ${pattern}" >&2

      # If tarball, extract
      if [[ "$pattern" == *.tar.gz ]]; then
        tar xzf "${tmpdir}/download" -C "$tmpdir"
        # Find the kcli binary inside extracted files
        local found
        found=$(find "$tmpdir" -name "kcli" -type f ! -name "*.tar.gz" | head -1)
        if [ -n "$found" ]; then
          mv "$found" "$dest"
        else
          echo "ERROR: kcli binary not found in tarball" >&2; exit 1
        fi
      else
        mv "${tmpdir}/download" "$dest"
      fi

      chmod +x "$dest"
      echo "Installed: $dest" >&2
      return 0
    fi
  done

  echo "ERROR: Could not download kcli ${version} for ${triple}" >&2
  echo "Available releases: https://github.com/${KCLI_REPO}/releases" >&2
  return 1
}

# --- Build from source ---
build_from_source() {
  local dest="$1"
  local version="$2"

  echo "Building kcli from source (github.com/${KCLI_REPO})..." >&2

  local install_ref="latest"
  if [ "$version" != "latest" ]; then
    install_ref="$version"
  fi

  # Use GOBIN to control output location
  local tmpbin
  tmpbin=$(mktemp -d)
  GOBIN="$tmpbin" go install "github.com/${KCLI_REPO}/cmd/kcli@${install_ref}"

  if [ ! -f "${tmpbin}/kcli" ]; then
    echo "ERROR: go install succeeded but kcli binary not found" >&2
    rm -rf "$tmpbin"
    exit 1
  fi

  mv "${tmpbin}/kcli" "$dest"
  chmod +x "$dest"
  rm -rf "$tmpbin"

  echo "Built and installed: $dest" >&2
}

# --- Main ---
main() {
  local triple
  triple=$(detect_platform)
  echo "Platform: $triple"

  local version
  version=$(resolve_version)

  mkdir -p "$BINARIES_DIR"

  local dest="${BINARIES_DIR}/kcli-${triple}"
  echo "Target: $dest"

  if [ "$KCLI_BUILD" = "1" ]; then
    build_from_source "$dest" "$version"
  else
    download_release "$triple" "$version" "$dest"
  fi

  # Verify the binary runs
  if "$dest" version 2>/dev/null; then
    echo "Verification: OK"
  else
    echo "Warning: 'kcli version' did not succeed (binary may require specific runtime env)" >&2
  fi

  echo ""
  echo "kcli binary ready at: $dest"
  echo "Source: https://github.com/${KCLI_REPO}"
}

main
