# Release Recovery Report — v1.4.0

**Date**: 2026-05-22  
**Branch**: `release/recover-v1.4.0`  
**Backup tag**: `backup-before-v1.4.0-recovery`

---

## Problem Statement

All releases after v1.0.0 (v1.1.0, v1.2.0, v1.4.0) installed successfully but failed to launch on macOS with:

> "The application 'Kubilitics' can't be opened."

v1.0.0 worked correctly and is the last known-good baseline.

---

## Root Causes Found

### RC-1: `LSRequiresCarbon` in Info.plist (BREAKING — macOS 26)

**Severity**: P0 for macOS 26 users  
**Introduced**: v1.1.0 (Tauri template injects this key)  
**Fixed in commit**: `9843ce2b`

Tauri's macOS bundle template injected `LSRequiresCarbon = true` into `Contents/Info.plist`. On macOS 26 (and macOS 15+ in strict mode), `launchd` rejects this key with POSIX error 163 (spawn failure), producing "The application can't be opened."

**Fix**: Post-build Python script strips `LSRequiresCarbon` and injects `NSPrincipalClass = NSApplication`.

---

### RC-2: `--deep` codesign regression introduced in `bbfb37de` (BREAKING — all macOS 13+)

**Severity**: P0  
**Introduced**: `bbfb37de fix(ci): sign DMG with codesign before notarize; use --deep re-sign`  
**Fixed in this recovery**

The last CI fix commit reverted the correct "sign inside-out" approach (sign each sidecar binary individually, then sign the bundle) to a deprecated `--deep` approach. Issues:

1. `--deep` is deprecated on macOS 13+ and behaves inconsistently with universal binaries
2. `--deep` applied the full WKWebView entitlements (including `allow-jit`, `allow-unsigned-executable-memory`) to ALL nested binaries including the Go sidecar executables
3. Go sidecar binaries with JIT entitlements fail Apple's notarization review — the app gets notarized but the DMG is flagged during Gatekeeper assessment
4. The `codesign --verify --deep --strict` step and the `spctl -a` Gatekeeper check were also removed in the same commit, making it impossible to detect this failure before publishing

**Fix**: Restored inside-out signing with separate `entitlements-sidecar.plist` for Go binaries. Restored codesign verification and Gatekeeper check.

---

### RC-3: TAURI_CLI_VERSION mismatch (RISKY → partially breaking)

**Severity**: P1  
**Introduced**: `0de43213` (framework upgraded to 2.11.2 but CLI stayed at 2.10.1)  
**Fixed in this recovery**

The `TAURI_CLI_VERSION` env var was pinned to `2.10.1` while the framework in Cargo.lock was `2.11.2`. A subsequent commit had to work around this by removing `infoPlistData` (a 2.11.x feature) from the Tauri CLI config. Running CLI 2.10.1 against a 2.11.2 framework can produce subtly incorrect bundles.

**Fix**: Updated `TAURI_CLI_VERSION: '2.11.2'`.

---

### RC-4: `infoPlistData` in Tauri CLI `--config` (BREAKING — build-time)

**Severity**: P0 (prevented build)  
**Introduced and fixed between v1.4.0 tag and HEAD**

Between the v1.4.0 tag and the CI fix commits, `infoPlistData` was added to the `--config` JSON passed to `cargo tauri build`. CLI 2.10.1 doesn't recognize this key and aborts with a schema validation error. The macOS build job would fail immediately.

**Fix**: Removed `infoPlistData`. Info.plist patching done via post-build Python script (works independently of CLI version).

---

### RC-5: YAML parse error in workflow (BREAKING — build-time)

**Severity**: P0 (prevented workflow from running)  
**Introduced and fixed between v1.4.0 tag and HEAD**

The Python heredoc in the "Verify and strip LSRequiresCarbon" step was not indented inside the YAML `run:` block. GitHub Actions failed to parse the workflow file, and the macOS build job would not execute.

**Fix**: Applied in `be4749a5`.

---

### RC-6: Overly permissive entitlements for Go sidecars (RISKY → notarization)

**Severity**: P1  
**Introduced with `entitlements.plist` at v1.1.0**  
**Fixed in this recovery**

`entitlements.plist` included `com.apple.security.cs.disable-library-validation`. This flag:
1. Is not needed for CGO_ENABLED=0 Go binaries (no dynamic C library loading)
2. Is not needed for the main Tauri app (all WKWebView frameworks are Apple-signed)
3. Can trigger notarization scrutiny and cause Gatekeeper to issue warnings

**Fix**: Removed `disable-library-validation` from `entitlements.plist`. Created separate `entitlements-sidecar.plist` with only `network.client`, `network.server`, `files.user-selected.read-write` for the Go binaries.

---

### RC-7: Windows brain binary output path fragility (SAFE → hardened)

**Severity**: Low (likely worked but fragile)

The Windows sidecar build used a chain of `cd` commands followed by relative `$BINS` path for the `go build -o` output. The relative path was correct by coincidence but could break if the cd chain ever changes.

**Fix**: Resolved `$BINS` to an absolute path (`ABS_BINS="$(pwd)/$BINS"`) at the start of the Windows build block.

---

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Fix TAURI_CLI_VERSION, restore inside-out signing, restore gatekeeper check, fix Windows path |
| `kubilitics-desktop/src-tauri/entitlements.plist` | Remove `disable-library-validation`; update comments |
| `kubilitics-desktop/src-tauri/entitlements-sidecar.plist` | **NEW** — minimal entitlements for Go sidecar binaries |
| `scripts/check-tauri-signing-config.sh` | Add check for sidecar entitlements file existence; add regression guard for `disable-library-validation` |
| `docs/v1.0.0-working-baseline.md` | **NEW** — v1.0.0 baseline documentation |
| `docs/post-v1-release-diff.md` | **NEW** — full change audit with risk classification |

---

## Verification Steps

### Pre-flight (local, already passed)

```bash
bash scripts/check-tauri-signing-config.sh
# Output: OK: tauri macOS signing config is intact.
```

### CI pipeline (requires push to `release/recover-v1.4.0` and tag)

1. Version-check job passes
2. macOS build succeeds — `cargo tauri build --bundles app`
3. LSRequiresCarbon strip succeeds
4. Inside-out re-sign completes without error
5. `codesign --verify --deep --strict` passes (all nested signatures valid)
6. DMG created
7. DMG signed
8. Notarization succeeds (requires APPLE_ID, APPLE_TEAM_ID, APPLE_PASSWORD secrets)
9. `xcrun stapler validate` passes
10. `spctl -a -vv -t install` passes — **Gatekeeper accepts the DMG**
11. Artifacts uploaded

### User acceptance

```
✓ Download DMG from GitHub release
✓ Mount DMG
✓ Drag Kubilitics.app to Applications
✓ Open Kubilitics → app launches (no "can't be opened" dialog)
✓ AI tab available (brain sidecar connects)
✓ Cluster list loads
```

---

## Why v1.0.0 Worked

1. No `kubilitics-ai-server` in externalBin — less surface area for missing binary failures
2. No custom entitlements — signed with hardened runtime only, no flags to scrutinize
3. Tauri built both `.app` AND `.dmg` in one step — no manual re-signing required
4. Notarization was `continue-on-error: true` — the release published even if notarization timed out
5. No post-build Info.plist patching — no chance for YAML/script errors to break the build

---

## Recommended Next Steps

1. Tag `release/recover-v1.4.0` HEAD as `v1.4.1` (patch release for CI pipeline fix)
2. Delete GitHub releases for v1.1.0, v1.2.0-rc.x, v1.2.0, v1.4.0 (all are broken)
3. Keep v1.0.0 as the stable fallback
4. Promote v1.4.1 as the new stable release
5. Consider adding a `desktop-ci.yml` step that builds the .app on PR merge to validate the bundle (not just Rust compilation)
