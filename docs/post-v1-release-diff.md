# Post-v1.0.0 Release Change Audit

## Summary

Between `v1.0.0` and `HEAD` (`release/recover-v1.4.0`), **14 release-critical changes** were made. This document classifies each as SAFE, RISKY, or BREAKING and explains the impact.

---

## Change Inventory

### 1. Added `kubilitics-ai-server` to `externalBin` — **RISKY**

**File**: `kubilitics-desktop/src-tauri/tauri.conf.json`

```diff
 "externalBin": [
   "binaries/kubilitics-backend",
+  "binaries/kubilitics-ai-server",
   "binaries/kcli"
 ]
```

**Risk**: Tauri refuses to build if this binary doesn't exist in `binaries/`. The CI workflow added the build step for this binary, but early releases (v1.1.0, v1.2.0-rc.x) sourced it from an external repo (`vellankikoti/kotg.ai`) that required a checkout step. If that checkout failed silently or the brain binary path was wrong, the Tauri build would fail or produce a bundle missing a required sidecar.

At runtime, Tauri checks that all `externalBin` binaries exist inside `Contents/MacOS/` at launch. If any are missing, the app fails to open.

**Status**: Fixed. Brain now builds from `brain/` in-monorepo. CI verify step confirms binary presence.

---

### 2. Entitlements file introduced — **RISKY → BREAKING**

**File**: `kubilitics-desktop/src-tauri/tauri.conf.json`

```diff
-"entitlements": null
+"entitlements": "entitlements.plist"
```

**Risk (original)**: The new `entitlements.plist` included `com.apple.security.cs.disable-library-validation`. This entitlement is scrutinized by Apple during notarization. For static Go binaries (CGO_ENABLED=0), it's unnecessary and can trigger Gatekeeper rejection or notarization delays.

**Status**: Fixed in this recovery. `disable-library-validation` removed from `entitlements.plist`. Separate `entitlements-sidecar.plist` created for Go binaries (no JIT entitlements).

---

### 3. minimumSystemVersion raised 10.13 → 12.0 — **SAFE**

**File**: `kubilitics-desktop/src-tauri/tauri.conf.json`

Tauri 2 requires macOS 10.13+ officially, but WKWebView features used by Tauri 2 are only reliable on macOS 12+. Raising the floor to 12.0 is correct and safe.

---

### 4. LSRequiresCarbon in Info.plist — **BREAKING → FIXED**

**Commit**: `9843ce2b fix(macos26): remove LSRequiresCarbon`

Tauri's bundle template injected `LSRequiresCarbon = true` into the app's Info.plist. On macOS 26 (future macOS), launchd rejects any app with this key because the Carbon framework no longer exists, producing a POSIX 163 spawn failure — the exact error behind "The application can't be opened."

**Fix**: Post-build Python script strips `LSRequiresCarbon` and injects `NSPrincipalClass = NSApplication`.

---

### 5. Tauri framework upgraded 2.10.3 → 2.11.2 — **RISKY**

**Commit**: `0de43213 fix(desktop): update Tauri`

The framework was upgraded for macOS 26 compatibility (new WKWebView APIs). However, the Tauri CLI version was NOT updated (still pinned to 2.10.1). This caused:

- CLI 2.10.1 schema validation rejecting `infoPlistData` (a 2.11.x config key) — required a follow-up commit to remove it
- Potential incompatibilities between the CLI's bundle logic and the framework's binary format

**Status**: Fixed in this recovery by updating `TAURI_CLI_VERSION: '2.11.2'`.

---

### 6. Tauri CLI version mismatch — **BREAKING**

**File**: `.github/workflows/release.yml` line 24 (before fix)

`TAURI_CLI_VERSION: '2.10.1'` while framework was `2.11.2`. The pre-built CLI download would use the 2.10.1 binary which doesn't understand the framework 2.11.2 bundle format or schema additions.

**Status**: Fixed. `TAURI_CLI_VERSION: '2.11.2'`.

---

### 7. macOS runner changed `macos-latest` → `macos-15` — **SAFE**

Explicit pinning to `macos-15` prevents silent breakage when GitHub updates `macos-latest`. Good practice.

---

### 8. Tauri build changed `--bundles app,dmg` → `--bundles app` — **RISKY**

The manual DMG creation pipeline (create-dmg + re-sign + notarize) replaced Tauri's built-in DMG creation. This is necessary because:

1. Tauri's built-in DMG build on macOS 15+ runners requires `create-dmg` to be pre-installed (it isn't)
2. We need to patch Info.plist before creating the DMG
3. We need control over the DMG signing order

**Risk**: The custom pipeline has more steps that can fail independently.

**Status**: The custom pipeline is now correct (all steps verified in this recovery).

---

### 9. `--deep` codesign re-sign (regression introduced in `bbfb37de`) — **BREAKING**

**Commit**: `bbfb37de fix(ci): sign DMG with codesign before notarize; use --deep re-sign`

This commit **reverted** the correct "sign inside-out" approach to a deprecated `--deep` approach:

**Before (correct)**:
```bash
for bin in "$APP/Contents/MacOS/"*; do
  codesign --force --sign "$IDENTITY" --options runtime \
    --entitlements entitlements.plist "$bin"
done
codesign --force --sign "$IDENTITY" --options runtime \
  --entitlements entitlements.plist "$APP"
```

**After (broken)**:
```bash
codesign --force --deep --sign "$IDENTITY" --options runtime \
  --entitlements entitlements.plist "$APP"
```

Issues with `--deep`:
1. Deprecated on macOS 13+
2. Applies the same (full JIT) entitlements to ALL nested binaries, including Go sidecars that don't need JIT
3. Misbehaves with universal binaries (lipo'd arm64+x86_64) in certain macOS versions
4. Apple's notarization can reject apps where Go binaries carry unnecessary restricted entitlements

**Status**: Fixed. Restored inside-out signing with separate entitlements for sidecars.

---

### 10. Codesign verification removed (regression in `bbfb37de`) — **RISKY**

The same commit also removed:
```bash
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vv -t install "$DMG"
```

These were the only CI steps that would catch "the DMG will fail to open" before publishing to users.

**Status**: Fixed. Both verification steps restored.

---

### 11. Notarization made mandatory (no `continue-on-error`) — **SAFE**

v1.0.0 had `continue-on-error: true` on notarization. The current approach hard-fails if APPLE_ID is empty, and runs spctl after notarization. This is correct — shipping an un-notarized DMG causes "The application can't be opened." for users.

---

### 12. `infoPlistData` key added then removed — **BREAKING (transient)**

At some point between v1.4.0 tagging and CI fixes, `infoPlistData` was added to the Tauri `--config` JSON to set `NSPrincipalClass` and `LSMinimumSystemVersion`. But CLI 2.10.1 doesn't support this key and would abort with a schema validation error, causing the entire macOS build to fail.

**Status**: Fixed. The Python post-processing script handles Info.plist modifications instead.

---

### 13. YAML heredoc parse error — **BREAKING (transient)**

**Commit**: `be4749a5 fix(ci): fix YAML parse error — heredoc Python must be indented`

The Python heredoc in the "Verify and strip LSRequiresCarbon" step was not indented, causing GitHub Actions YAML to fail to parse the workflow file. The macOS build job would not even start.

**Status**: Fixed.

---

### 14. Updater endpoint changed to personal repo — **RISKY**

```diff
-"https://github.com/kubilitics/kubilitics/releases/latest/download/latest.json"
+"https://github.com/vellankikoti/kubilitics/releases/latest/download/latest.json"
```

Users who installed v1.0.0 (pointing to the org repo) will check the old endpoint for updates. Users on v1.1.0+ (personal repo) will check the new endpoint. This split means auto-update only works if you're on the same lineage.

**Recommendation**: Ensure v1.0.0 users can reach a migration release or the org repo serves a redirect.

---

## Root Cause Summary

| Release | Primary Failure |
|---------|----------------|
| v1.1.0  | Brain binary from external repo; `LSRequiresCarbon` present |
| v1.2.0-rc.x | Multiple: monorepo brain migration instability, signing issues |
| v1.4.0 | YAML parse error → build never ran; then infoPlistData schema error; then --deep signing regression |
| HEAD (before recovery) | `--deep` signing applied wrong entitlements to Go sidecars; codesign verification removed; CLI 2.10.1 vs framework 2.11.2 |

**Root cause of "The application can't be opened."**: The combination of `LSRequiresCarbon` (macOS 26), incorrect codesign re-signing with `--deep` (all macOS 13+), and overly permissive entitlements on Go sidecars triggering notarization rejection.
