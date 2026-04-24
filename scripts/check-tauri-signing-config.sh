#!/usr/bin/env bash
# check-tauri-signing-config.sh — regression guard.
#
# Asserts that tauri.conf.json has the macOS signing fields in a state
# that produces stable keychain ACLs. A future refactor or merge conflict
# that nulls these out would silently re-introduce the "password prompt
# on every save" UX bug we spent a week killing. Fail loud here instead.
#
# Checks:
#   1. bundle.macOS.entitlements is a non-null string
#   2. That file exists on disk
#   3. The entitlements file contains the keychain-access-groups key
#      (the load-bearing line for ACL stability)
#
# NOT checked: signingIdentity. The CI release workflow overrides it
# via --config at build time, so tauri.conf.json's signingIdentity
# value (including null) is acceptable in CI. Local dev needs a real
# value, but that's enforced by `cargo tauri dev` failing — not this
# script's job.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/kubilitics-desktop/src-tauri/tauri.conf.json"

if [ ! -f "$CONF" ]; then
  echo "FAIL: $CONF not found."
  exit 1
fi

# Extract bundle.macOS.entitlements via python for robust JSON parsing.
ENT=$(python3 -c "
import json, sys
with open('$CONF') as f:
    cfg = json.load(f)
v = cfg.get('bundle', {}).get('macOS', {}).get('entitlements')
print('' if v is None else v)
")

if [ -z "$ENT" ]; then
  echo "FAIL: bundle.macOS.entitlements is null/missing in tauri.conf.json."
  echo "      Regression of the macOS signing work. See docs/macos-signing.md."
  exit 1
fi

ENT_PATH="$ROOT/kubilitics-desktop/src-tauri/$ENT"
if [ ! -f "$ENT_PATH" ]; then
  echo "FAIL: entitlements file $ENT_PATH does not exist."
  exit 1
fi

if ! grep -q 'keychain-access-groups' "$ENT_PATH"; then
  echo "FAIL: $ENT_PATH is missing the keychain-access-groups entry."
  echo "      Without it, keychain ACLs are bound to binary hash, not team."
  echo "      See docs/macos-signing.md §entitlements.plist."
  exit 1
fi

echo "OK: tauri macOS signing config is intact."
