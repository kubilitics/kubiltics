# Desktop Security (C4.1, C4.2)

## Secure kubeconfig handling (C4.1)

- **Do not log or display** kubeconfig file contents, paths in plaintext in logs, or tokens. When logging errors (e.g. "Failed to read kubeconfig"), do not include the path or content. Use generic messages or redact (e.g. "Failed to read kubeconfig at configured path").
- **Do not store** raw kubeconfig or token strings in the app unless necessary; prefer path or reference. When the desktop reads kubeconfig (e.g. `read_kubeconfig`, `get_kubeconfig_info`), the content is used only for connection; it is not logged or sent to any external service.
- **Keychain (optional):** For enterprise, consider storing credentials in the OS keychain (macOS Keychain, Windows Credential Manager, Linux secret service) and referencing them by name. Current implementation uses file-based kubeconfig as configured by the user.
- **Checklist:** No kubeconfig paths or tokens in logs; no display of raw tokens in UI; document above in this file.

## Multiple kubeconfigs and validation (C4.2)

- **Multiple paths:** The desktop supports multiple kubeconfig paths via `auto_detect_kubeconfig` (default `~/.kube/config` and `KUBECONFIG` env) and optional path parameter in `get_kubeconfig_info`, `read_kubeconfig`, `validate_kubeconfig`. Users can select a file (e.g. via file dialog) and validate per context.
- **Validation:** `validate_kubeconfig(path)` checks file exists, is readable, and parses as YAML with required `clusters`, `contexts`, `users`. Connection errors per context can be shown by attempting a connection (backend or in-app) and surfacing the error message without logging secrets.
- **Read-only by default:** The app does not modify the user's kubeconfig except when the user explicitly switches context via `switch_context` (which updates `current-context`). No automatic overwrite or write without user action. When implementing file dialog selection, do not overwrite the user's default kubeconfig; use the selected path for the session only unless the user explicitly saves.
