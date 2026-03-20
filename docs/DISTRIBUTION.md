# Distribution & Delivery (Phase R)

## R1 — Desktop build & distribution

### R1.1 Desktop build pipeline

- **Location:** `.github/workflows/desktop-ci.yml`
- **Platforms:** macOS (universal: Intel + Apple Silicon), Windows x64, Linux x64. Optional Linux ARM64 job can be added.
- **Triggers:** Push/PR to `main` or `develop` when `kubilitics-desktop/**` or `kubilitics-backend/**` change.
- **Artifacts:** Build outputs (DMG on macOS, MSI on Windows, DEB on Ubuntu) are uploaded as workflow artifacts.

### R1.2 Code signing and notarization

- **macOS:** For distribution outside the Mac App Store you need:
  - **Developer ID Application** certificate (Apple Developer Program).
  - **Notarization:** Submit the app (or DMG) to Apple with `xcrun notarytool submit`; staple with `xcrun stapler staple`.
  - In CI, store the certificate as a secret; use it in the build step before `cargo tauri build`. Tauri supports `TAURI_SIGNING_IDENTITY` and notarization env vars.
- **Windows:** Sign the installer and binary with a code-signing certificate (e.g. from DigiCert, Sectigo). In CI, use `signtool.exe` or Tauri’s config; store the cert as a secret.
- **Linux:** Optional GPG signing of packages (e.g. `.deb`, AppImage). Sign the release files and publish signatures alongside artifacts.

**Implementation:** Configure secrets in the repo (e.g. `APPLE_CERTIFICATE`, `WINDOWS_CERTIFICATE`, `APPLE_APP_PASSWORD` for notarization) and add signing steps to the desktop workflow. See [Tauri signing docs](https://v2.tauri.app/start/distribution/sidecar/#signing) and [notarization](https://v2.tauri.app/start/distribution/sidecar/#notarize-macos-apps).

### R1.3 Installers

- **macOS:** DMG (and optionally PKG). Produced by Tauri when building on `macos-latest`; output under `src-tauri/target/release/bundle/dmg/`.
- **Windows:** MSI and/or EXE. Produced on `windows-latest`; output under `src-tauri/target/release/bundle/msi/` and `bundle/nsis/`.
- **Linux:** DEB, RPM, AppImage. Tauri’s `targets: "all"` produces these when building on Linux; install deps (e.g. `libgtk-3-dev`, `librsvg2-dev`) as in the workflow.

CI uploads the whole `bundle/**` so all installer types for that OS are retained.

### R1.4 Native menus (optional for MVP)

- **Goal:** File (Open, Close, Quit), Edit (Cut, Copy, Paste), View (Refresh, Zoom), Help (Documentation, About).
- **Implementation:** Use Tauri’s menu API in `main.rs` (or a `menu` module): build a `Menu` and set it with `app.set_menu(menu)` or per-window. Optional for MVP; add when polishing desktop UX.

### R1.5 Auto-updater (optional for MVP)

- **Goal:** Secure channel (HTTPS), signed updates, user-controlled (no silent unsigned code).
- **Design:** Use Tauri’s updater plugin; serve a `latest.json` (or equivalent) from your release endpoint with version, URLs, and signature. Backend must use HTTPS; verify signature before applying update.
- **Implementation:** Enable `tauri-plugin-updater`; configure update URL and signing; document in this file and in app Settings. Optional for MVP.

---

## R2 — Helm and in-cluster deployment

- **R2.1:** Helm chart at `deploy/helm/kubilitics/`: Deployment, Service, ConfigMap (via values), PVC, ServiceAccount. See chart README for install and values.
- **R2.2:** Optional frontend: set `frontend.enabled: true` in values and extend the chart (e.g. nginx sidecar or separate Deployment serving static build). Documented in chart README.

---

## R3 — CI/CD

- **R3.1:** GitHub Actions: `backend-ci.yml` (test, lint, build), `frontend-ci.yml` (test, build), `desktop-ci.yml` (test, build all platforms). All run on push/PR to `main`/`develop` on path changes.
- **R3.2:** Test reports: backend and frontend workflows can write logs to `test_reports/` and upload as artifacts. For JUnit/Playwright, add reporters and upload artifacts in the same way.
- **R3.3:** Release automation: tag (e.g. `v1.0.0`) triggers release workflow; build backend, frontend, desktop; attach artifacts to GitHub Release; optional changelog from conventional commits. Document in repo CONTRIBUTING or docs.

---

## W1.3 — Deploy website

- **Workflow:** `.github/workflows/website.yml` builds the static site from `kubilitics-website/` and uploads it as a GitHub Pages artifact. The deploy job runs only on `main` and uses `actions/deploy-pages`.
- **Enable GitHub Pages:** In the repo go to **Settings → Pages → Build and deployment**: choose **GitHub Actions** as the source. The first run of the workflow (or a push to `main` that touches `kubilitics-website/`) will build and deploy. The site will be available at `https://<org>.github.io/<repo>/` (or your custom domain if configured).
- **Alternative:** To use Vercel or Netlify, connect the repo and set the root (or `kubilitics-website`) and build command `npm run build`; point publish to `dist`. SSL and custom domain are configured in the hosting provider.
