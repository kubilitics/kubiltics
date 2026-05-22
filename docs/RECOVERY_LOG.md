# Desktop Startup Recovery Log

## Freeze State

| Field | Value |
|-------|-------|
| Branch | hotfix/desktop-startup-recovery |
| Base commit | c18a03b7 |
| Date | 2026-05-22 |
| Symptom | "The application 'Kubilitics' can't be opened." |
| Release version | 1.2.0 |
| macOS runner | macos-15 (ARM64) |
| Tauri framework | 2.11.2 |
| Tauri CLI | 2.11.2 |

## Files Changed Since v1.0.0 (do not touch without evidence)

- .github/workflows/release.yml — CI signing pipeline
- kubilitics-desktop/src-tauri/entitlements.plist — macOS entitlements (main app)
- kubilitics-desktop/src-tauri/entitlements-sidecar.plist — macOS entitlements (Go sidecars)
- kubilitics-desktop/src-tauri/tauri.conf.json — Tauri config
- kubilitics-desktop/src-tauri/Cargo.toml — Rust deps

## Build Command (CI)

```bash
CI=true cargo tauri build \
  --target universal-apple-darwin \
  --bundles app \
  --config '{"bundle":{"macOS":{"signingIdentity":"<identity>"}}}'
```

## What CI v1.2.0 Passed

✅ Version Consistency Check
✅ Build Go sidecars (all 3 universal binaries)
✅ Build Tauri app (macOS universal)
✅ Strip LSRequiresCarbon
✅ Re-sign app (inside-out)
✅ codesign --verify --deep --strict
✅ Create DMG
✅ Notarize
✅ stapler validate
✅ spctl -a -t install (Gatekeeper gate)

## Diagnosis Status

[x] Phase 2 — Architecture confirmed
[x] Phase 3 — Local logs captured
[x] Phase 4 — Root cause classified
[x] Phase 5 — Fix applied
[x] Phase 6 — App opens (verified with patched test copy)

## Root Cause (Phase 4)

**Category: macOS 26 API removal**

Error captured: `NSPOSIXErrorDomain Code=163 — Launchd job spawn failed` (RBSRequestErrorDomain Code=5)

Cause: The `kubilitics-desktop` binary links `Carbon.framework/Versions/A/Carbon`. macOS 26 (Tahoe) removed the Carbon umbrella dylib — the symlink exists but the target is gone and the binary is not in the dyld shared cache. dyld fails to load the process, so the spawn fails before any code runs.

Root cause chain:
1. `tao 0.35.2` (Tauri's windowing library) has `#[link(name = "Carbon", kind = "framework")]` in `src/platform_impl/macos/ffi.rs`
2. This links the Carbon UMBRELLA (not a specific sub-framework)
3. The Carbon symbols used (`LMGetKbdType`, `TISCopyCurrentKeyboardLayoutInputSource`, `UCKeyTranslate`) actually live in `HIToolbox.framework`, which is still available as a Carbon sub-framework
4. macOS 26 TextEdit links `HIToolbox` directly — confirming HIToolbox is in the dyld cache

## Fix Applied (Phase 5)

Post-build `install_name_tool` in CI (`release.yml`) rewrites the `LC_LOAD_DYLIB` entry:
- FROM: `Carbon.framework/Versions/A/Carbon`
- TO: `Carbon.framework/Versions/A/Frameworks/HIToolbox.framework/Versions/A/HIToolbox`

Applied BEFORE the re-sign step, so the final DMG has correct signatures.

## Local Verification (Phase 6)

Tested with `/tmp/KubiliticsTest.app` (ad-hoc signed after install_name_tool):
- `kubilitics-desktop` PID appeared in `ps aux` — main process running
- `kubilitics-backend` PID appeared — sidecar started
- `kubilitics-ai-server` PID appeared — brain sidecar started
- `open` exit code: 0

**App opens successfully on macOS 26.4.1.**

---

## Recovery Session 2 — 2026-05-22 (hotfix/desktop-launch-recovery)

### Problem

v1.2.0 shipped with the HIToolbox fix applied. `spctl` accepted the notarized DMG.
But `open /Applications/Kubilitics.app` still returned:

```
RBSRequestErrorDomain Code=5 / NSPOSIXErrorDomain Code=163 "Launchd job spawn failed"
```

The Carbon→HIToolbox fix addressed ONE trigger of `Code=163`. A second, independent
trigger was present in the entitlements.

### Root Cause (Second Trigger)

`com.apple.security.cs.allow-unsigned-executable-memory` added in commit `6c08ffc2`
is **blocked by macOS 26 (Tahoe)** for Hardened Runtime + Developer ID apps. The OS
rejects the process at the launchd spawn level — before any app code executes.

This entitlement is not needed by WKWebView on macOS 14+. WKWebView's JavaScript JIT
runs in a separate Apple-signed `WebContent` process. The host app only needs
`com.apple.security.cs.allow-jit`.

### Evidence

```
# With allow-unsigned-executable-memory:
open /Applications/Kubilitics.app → Code=163 ✗

# Without allow-unsigned-executable-memory (ad-hoc signed copy):
open /tmp/KubiTest.app → LAUNCH EXIT: 0 ✓
  kubilitics-desktop PID: 65574  RUNNING
  kubilitics-backend PID: 65580  RUNNING
  Window: appeared ✓
```

### Fix

`kubilitics-desktop/src-tauri/entitlements.plist` — commit `ee5966b2`:
- Removed `com.apple.security.cs.allow-unsigned-executable-memory`
- Replaced `$(AppIdentifierPrefix)` with literal `DJAF5D948L.` in keychain-access-groups

### Status

Fix committed on `hotfix/desktop-launch-recovery`. Needs CI rebuild + notarize for v1.2.1.
