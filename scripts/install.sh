#!/bin/sh
# Kubilitics kcli installer — https://kubilitics.com
# Usage: curl -fsSL https://kubilitics.com/install.sh | sh
#
# Environment variables:
#   INSTALL_DIR  — override install location (default: /usr/local/bin)
#   VERSION      — pin to a specific version (default: latest)

set -e

REPO="kubilitics/kubiltics"
BINARY="kcli"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
fail()  { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

# ── Detect platform ────────────────────────────────────────────────────────
detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "darwin" ;;
    Linux)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)       fail "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "amd64" ;;
    aarch64|arm64)   echo "arm64" ;;
    armv7l)          echo "arm" ;;
    *)               fail "Unsupported architecture: $(uname -m)" ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"

# ── Resolve version ────────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  info "Detecting latest version..."
  if command -v curl >/dev/null 2>&1; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')
  elif command -v wget >/dev/null 2>&1; then
    VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\([^"]*\)".*/\1/')
  else
    fail "curl or wget is required"
  fi
fi

[ -z "$VERSION" ] && fail "Could not determine latest version"
info "Version: v$VERSION"

# ── Download ────────────────────────────────────────────────────────────────
URL="https://github.com/$REPO/releases/download/v${VERSION}/${BINARY}-v${VERSION}-${OS}-${ARCH}.tar.gz"
CHECKSUM_URL="https://github.com/$REPO/releases/download/v${VERSION}/checksums.txt"

info "Downloading $BINARY v$VERSION ($OS/$ARCH)..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMPDIR/archive.tar.gz" || fail "Download failed — check that v$VERSION exists for $OS/$ARCH"
  curl -fsSL "$CHECKSUM_URL" -o "$TMPDIR/checksums.txt" 2>/dev/null || true
elif command -v wget >/dev/null 2>&1; then
  wget -q "$URL" -O "$TMPDIR/archive.tar.gz" || fail "Download failed"
  wget -q "$CHECKSUM_URL" -O "$TMPDIR/checksums.txt" 2>/dev/null || true
fi

# ── Verify checksum ────────────────────────────────────────────────────────
if [ -f "$TMPDIR/checksums.txt" ]; then
  EXPECTED=$(grep "${BINARY}-v${VERSION}-${OS}-${ARCH}.tar.gz" "$TMPDIR/checksums.txt" | awk '{print $1}')
  if [ -n "$EXPECTED" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      ACTUAL=$(sha256sum "$TMPDIR/archive.tar.gz" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
      ACTUAL=$(shasum -a 256 "$TMPDIR/archive.tar.gz" | awk '{print $1}')
    fi
    if [ -n "$ACTUAL" ] && [ "$EXPECTED" = "$ACTUAL" ]; then
      ok "Checksum verified"
    elif [ -n "$ACTUAL" ]; then
      fail "Checksum mismatch (expected: $EXPECTED, got: $ACTUAL)"
    fi
  fi
fi

# ── Extract and install ────────────────────────────────────────────────────
info "Extracting..."
tar xzf "$TMPDIR/archive.tar.gz" -C "$TMPDIR"

if [ ! -f "$TMPDIR/$BINARY" ]; then
  # Try nested directory (some archives have a subdirectory)
  FOUND=$(find "$TMPDIR" -name "$BINARY" -type f | head -1)
  [ -n "$FOUND" ] || fail "Binary not found in archive"
  mv "$FOUND" "$TMPDIR/$BINARY"
fi

info "Installing to $INSTALL_DIR/$BINARY..."

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPDIR/$BINARY" "$INSTALL_DIR/$BINARY"
  chmod +x "$INSTALL_DIR/$BINARY"
else
  sudo mv "$TMPDIR/$BINARY" "$INSTALL_DIR/$BINARY"
  sudo chmod +x "$INSTALL_DIR/$BINARY"
fi

# ── Verify installation ────────────────────────────────────────────────────
if command -v "$BINARY" >/dev/null 2>&1; then
  ok "$BINARY v$VERSION installed successfully"
  printf "\n"
  printf "  ${BOLD}Get started:${NC}\n"
  printf "    ${CYAN}kcli version${NC}         — verify installation\n"
  printf "    ${CYAN}kcli completion${NC}      — set up shell completions\n"
  printf "    ${CYAN}kcli get pods${NC}        — list pods in current context\n"
  printf "\n"
  printf "  ${BOLD}Documentation:${NC} https://kubilitics.com/docs\n"
  printf "\n"
else
  ok "$BINARY installed to $INSTALL_DIR/$BINARY"
  printf "  Note: $INSTALL_DIR may not be in your PATH.\n"
  printf "  Add it: export PATH=\"$INSTALL_DIR:\$PATH\"\n"
fi
