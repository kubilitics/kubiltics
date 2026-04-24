# macOS Code-Signing and Notarization — Operator Runbook

Kubilitics Desktop signs all macOS binaries with an Apple Developer ID
Application certificate. This doc walks through the one-time setup,
CI secrets, notarization, and common failure modes.

## Why this matters

macOS Keychain Services binds the ACL on each generic-password entry
to the **code-signing identity** of the writing binary. With ad-hoc
signing the ACL is bound to the binary hash, so every rebuild and
every release update invalidates the ACL and users hit the "enter
login password" dialog on the next save. With a Developer ID
Application cert the ACL binds to TeamIdentifier + bundle ID, so a
single "Always Allow" persists across every rebuild and every future
version update.

The load-bearing file is `kubilitics-desktop/src-tauri/entitlements.plist`
— specifically its `keychain-access-groups` entry. Without that entry,
the team-bound ACL behavior does NOT apply, even with a valid cert.

## Prerequisites

- Apple Developer Program membership ($99/year).
- Admin access to the GitHub repository for Secrets.
- macOS host to run the local helper.

## Part 1: Local developer setup

One-time per developer machine.

### 1. Acquire the certificate

1. Sign in at https://developer.apple.com/account/resources/certificates/list.
2. Click + → macOS → **Developer ID Application**.
3. Follow the Certificate Signing Request (CSR) prompt:
   - Open Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority.
   - User email: your Apple ID email. Common name: anything distinct.
   - "Saved to disk" → save `CertificateSigningRequest.certSigningRequest`.
4. Upload the CSR to Apple. Download the `.cer` Apple issues.
5. Double-click the `.cer`. macOS imports it into login keychain alongside the private key generated in step 3.

### 2. Confirm the cert is usable

```bash
security find-identity -v -p codesigning | grep 'Developer ID Application'
```

You should see a line like:
```
1) A1B2C3D4E5... "Developer ID Application: Your Name (DJAF5D948L)"
```

### 3. Wire into tauri.conf.json

Run the helper:
```bash
bash scripts/setup-dev-signing.sh
```

It prints the exact line to paste into `kubilitics-desktop/src-tauri/tauri.conf.json`'s `bundle.macOS.signingIdentity` field.

### 4. First dev build

```bash
cd kubilitics-desktop/src-tauri
cargo tauri dev
```

The first `codesign` call prompts macOS for permission to use the cert's
private key — click **Always Allow**. One time, forever.

The first API-key Save in the running app prompts for keychain ACL
permission — click **Always Allow**. Also one time, forever.

Every subsequent rebuild and save is silent.

### Escape hatch

If you ever need to build without the cert (debugging on a machine
that doesn't have it imported):
```bash
APPLE_SIGNING_IDENTITY="-" cargo tauri dev
```
This forces ad-hoc signing. Cost: the password-prompt-on-save UX bug
returns until you unset the env var.

## Part 2: CI release signing

One-time per repository setup.

### 1. Export the cert as P12

Keychain Access → login → My Certificates → right-click the
"Developer ID Application: ..." entry → **Export**. Choose a strong
password. Save as `cert.p12`. Store the password in 1Password or
equivalent — you will need it for the GitHub secret.

### 2. Base64-encode for GitHub Actions

```bash
base64 -i cert.p12 -o cert.p12.b64
```

### 3. Set repository secrets

Go to https://github.com/vellankikoti/kubilitics/settings/secrets/actions
and set these secrets (names match the existing release.yml —
**do not invent new names**):

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Contents of `cert.p12.b64` (the base64 string itself) |
| `APPLE_CERTIFICATE_PASSWORD` | The P12 export password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (DJAF5D948L)` |
| `APPLE_ID` | Your Apple Developer email |
| `APPLE_PASSWORD` | App-specific password from https://appleid.apple.com/account/manage (NOT your Apple ID password) |
| `APPLE_TEAM_ID` | `DJAF5D948L` |

### 4. Destroy the local P12

```bash
rm cert.p12 cert.p12.b64
```

The private key remains safely in your login keychain for future
local signing.

### 5. First CI-signed release

Push a tag like `v1.2.0-rc.6`. The release workflow will:
1. Import the P12 into a temporary build keychain.
2. Run `cargo tauri build`, which signs with `APPLE_SIGNING_IDENTITY`.
3. Assert the produced `.app` is signed with Developer ID Application.
4. Run `xcrun notarytool submit --wait`.
5. Run `xcrun stapler staple`.
6. Assert `xcrun stapler validate` and `spctl -a -t install` both pass.

Any step failing fails the job — we never ship un-notarized artifacts.

## Part 3: Secret rotation

Rotate when:
- Someone with repo admin access leaves the project.
- The P12 password is compromised.
- Scheduled quarterly hygiene (optional).

Procedure:
1. Re-export from Keychain Access with a new password (Part 2 step 1).
2. `base64 -i cert.p12 -o cert.p12.b64`.
3. Update `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` on the
   GitHub secrets page.
4. Trigger a no-op release (or wait for the next one) to confirm CI
   still passes.
5. `rm cert.p12 cert.p12.b64`.

## Part 4: Certificate expiry

Apple Developer ID Application certificates are valid for **5 years**.
When they expire:
- Local `cargo tauri dev` errors with "no signing identity found".
- Existing user installs show "Kubilitics can't be opened" ~24 hours
  after expiry (macOS caches the validity check briefly).

Recovery:
1. Generate a new certificate (Part 1 step 1) — same Team ID, new SHA.
2. Export + update GitHub secrets (Part 2 steps 1–4).
3. Update `tauri.conf.json`'s `signingIdentity` if the common name
   changed (usually it doesn't).
4. Users update Kubilitics. The new cert has the same TeamIdentifier,
   so their keychain ACLs remain valid — no re-prompt at save.

**Calendar reminder:** set a reminder for 60 days before the cert
expiry date. Apple does not auto-renew.

## Part 5: Common failure modes

### `cargo tauri dev` errors "no signing identity found"

The `signingIdentity` string in `tauri.conf.json` doesn't match any
certificate in login keychain. Causes:
- Typo (including trailing whitespace).
- Cert not imported.
- Cert expired.

Fix: `bash scripts/setup-dev-signing.sh`, paste the exact output line.

### CI fails at `security import`

The `APPLE_CERTIFICATE_PASSWORD` secret doesn't match the password the
`.p12` was exported with. Re-export (Part 2 step 1), re-upload
(Part 2 step 3).

### CI fails at `xcrun notarytool submit`

Common causes:
- `APPLE_ID` or `APPLE_PASSWORD` secret missing/wrong — regenerate the
  app-specific password at https://appleid.apple.com/account/manage.
- App is not hardened-runtime — verify `entitlements.plist` is wired
  (it should be; this repo asserts it in `check-tauri-signing-config.sh`).
- Embedded sidecar binaries (kubilitics-backend, kubilitics-ai-server,
  kcli) are not signed. Tauri signs them automatically when they live
  in `src-tauri/binaries/` with correct target-triple naming. If you
  add a new sidecar, ensure its name matches the triple convention.

To debug: check the submission log:
```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
```

### User still sees "enter login password" on save after upgrading

The keychain entry from the pre-Developer-ID install has an ACL bound
to the old ad-hoc hash. It never gets rewritten because macOS's ACL
matching rejects the read before the app gets a chance to write. Fix
for the user:
```bash
security delete-generic-password -s kubilitics
```
Then have them save in AI Settings again. One prompt, Always Allow,
permanent silence from that moment forward.

### Gatekeeper says "can't be opened, Apple cannot check"

This means the DMG is signed but NOT notarized (or stapling failed).
CI should catch this in the stapler validate step. If you see it on
a production install, there's a CI regression — check the failing
release workflow run and re-tag.

## What's explicitly NOT covered here

- **App Store distribution.** Requires a Mac App Store signing cert,
  not Developer ID. Different provisioning profiles, different review
  process. Not planned for Kubilitics v1.x.
- **Multi-team signing.** Kubilitics is a single-org product with a
  single Team ID (DJAF5D948L). Adding more Team IDs complicates keychain
  ACL behavior and isn't needed today.
- **Automatic cert rotation.** Apple doesn't offer an API for this.
  Manual renewal every 5 years with the calendar reminder above is
  sufficient.
