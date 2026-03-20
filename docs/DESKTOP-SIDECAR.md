# Desktop Sidecar and Port (C4.4)

## Sidecar binary

- **Name:** The desktop app expects the Kubilitics backend sidecar binary to be named **`kubilitics-backend`**. This is configured in:
  - **Tauri bundle:** `tauri.conf.json` → `bundle.externalBin`: `["binaries/kubilitics-backend"]` (or equivalent so the binary is available as `kubilitics-backend` to the sidecar API).
  - **Rust:** `kubilitics-desktop/src-tauri/src/sidecar.rs` → `sidecar("kubilitics-backend")`.

Build the backend and place the binary so the Tauri bundle includes it (e.g. copy `kubilitics-backend` to `kubilitics-desktop/binaries/` or configure your build to produce it there).

## Port

- **Backend port:** **8080** (default). The sidecar is started with `KUBILITICS_PORT=8080` and the frontend (when running in Tauri) uses `http://localhost:8080` as the backend base URL.
- **Health check:** The desktop checks `http://localhost:8080/health` to determine if the backend is ready and for periodic health monitoring.
- **CSP:** `tauri.conf.json` already allows `connect-src` to `http://localhost:8080` and `ws://localhost:8080`.

## Alignment summary

| Component        | Value                |
|-----------------|----------------------|
| Sidecar binary  | `kubilitics-backend` |
| Port            | 8080                 |
| Health URL      | `http://localhost:8080/health` |
| Frontend default (Tauri) | `http://localhost:8080` |
