#!/usr/bin/env bash
# release.sh — One-command release: bump → check → commit → tag → push.
#
# Usage:
#   ./scripts/release.sh 0.2.0           # Full release
#   ./scripts/release.sh 0.2.0 --dry-run # Validate only (no git push)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

DRY_RUN=false

# Parse args
if [ $# -lt 1 ]; then
  echo "Usage: $0 <version> [--dry-run]"
  echo "  Example: $0 0.2.0"
  echo "  Example: $0 0.2.0 --dry-run"
  exit 1
fi

VERSION="$1"
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    *) echo -e "${RED}Unknown flag: $1${NC}"; exit 1 ;;
  esac
  shift
done

# Ensure we're at repo root
if [ ! -f "kubilitics-frontend/package.json" ]; then
  echo -e "${RED}ERROR:${NC} Run this script from the repository root."
  exit 1
fi

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}ERROR:${NC} Working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Ensure on main branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}WARNING:${NC} You are on branch '$BRANCH', not 'main'."
  read -p "Continue anyway? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Kubilitics Release v${VERSION}${NC}"
if $DRY_RUN; then
  echo -e "${YELLOW}  [DRY RUN — no git push]${NC}"
fi
echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Bump versions
echo -e "${CYAN}[1/5]${NC} Bumping versions..."
./scripts/bump-version.sh "$VERSION"
echo ""

# Step 2: Run pre-release checks
echo -e "${CYAN}[2/5]${NC} Running pre-release checks..."
./scripts/pre-release-check.sh "$VERSION"
echo ""

# Step 3: Stage and commit
echo -e "${CYAN}[3/5]${NC} Committing version bump..."
git add -A
git commit -m "chore: release v${VERSION}"
echo -e "${GREEN}  ✓${NC} Committed"
echo ""

# Step 4: Tag
echo -e "${CYAN}[4/5]${NC} Creating tag v${VERSION}..."
git tag "v${VERSION}"
echo -e "${GREEN}  ✓${NC} Tagged v${VERSION}"
echo ""

# Step 5: Push
if $DRY_RUN; then
  echo -e "${YELLOW}[5/5]${NC} Dry run — skipping push."
  echo ""
  echo -e "${GREEN}Dry run complete.${NC} To finish the release:"
  echo "  git push && git push --tags"
else
  echo -e "${CYAN}[5/5]${NC} Pushing to remote..."
  git push
  git push --tags
  echo -e "${GREEN}  ✓${NC} Pushed"
  echo ""
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Release v${VERSION} triggered!${NC}"
  echo -e "${GREEN}══════════════════════════════════════════════════${NC}"
  echo ""
  echo "Monitor the release pipeline:"
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if echo "$REMOTE_URL" | grep -q "github.com"; then
    REPO=$(echo "$REMOTE_URL" | sed -E 's|.*github\.com[:/](.+)(\.git)?$|\1|' | sed 's/\.git$//')
    echo "  https://github.com/${REPO}/actions"
  else
    echo "  Check your CI/CD dashboard"
  fi
fi
