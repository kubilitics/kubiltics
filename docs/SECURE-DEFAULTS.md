# Zero-Trust and Secure Defaults (D1.2)

## Principles

- **Validate all inputs:** Path and query parameters are validated before use. Invalid values return 400.
- **Authorize per request:** Cluster access is resolved per request via `clusterId`; only registered clusters are accessible.
- **HTTPS in production:** Run the backend behind TLS in production; the server does not terminate TLS by default.
- **Secure headers:** Every response includes headers to reduce XSS, clickjacking, and MIME sniffing.
- **Destructive actions require confirmation:** Delete and Apply require an explicit confirmation header; the UI must not send it until the user confirms.

## Input validation

| Parameter   | Rule | Max length | Used in |
|------------|------|------------|---------|
| `clusterId` | Alphanumeric, hyphen, underscore | 128 | All cluster-scoped routes |
| `kind`      | Alphanumeric (resource kind as in path) | 64 | Resources list/get/delete |
| `namespace` | DNS subdomain (RFC 1123) or empty | 253 | Resources, logs, events, metrics |
| `name`      | DNS subdomain | 253 | Resource get/delete, pod logs/metrics |

Validation is implemented in `internal/pkg/validate`. Invalid input returns `400 Bad Request` with a generic message (no injection of input into error body).

## Secure response headers

The `SecureHeaders` middleware sets:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`

These are applied to all responses. For web or desktop UIs that load from the same origin or allowed CORS origins, adjust CSP if needed (e.g. for inline scripts or specific connect-src).

## Destructive actions and confirmation

### Backend requirement

- **DELETE** `/api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}`  
  Requires header: `X-Confirm-Destructive: true`. Otherwise returns `400` with message: *"Destructive action requires X-Confirm-Destructive: true"*.

- **POST** `/api/v1/clusters/{clusterId}/apply`  
  Requires header: `X-Confirm-Destructive: true`. Otherwise returns `400` with message: *"Apply requires X-Confirm-Destructive: true (review YAML before applying)"*.

The backend does not perform the delete or apply unless this header is present. The frontend must only send the header after the user has confirmed (e.g. in a confirmation dialog).

### Apply body size limit

- Config: `apply_max_yaml_bytes` (default 512KB). Request body for `/apply` is limited via `http.MaxBytesReader`; larger bodies are rejected with `400` (invalid body or YAML too large).

### Read-only default

- By default, the API allows read (GET) and destructive (DELETE, POST apply) only with the confirmation header for destructive operations. No automatic apply of arbitrary YAML; the client must explicitly send the confirm header after user review.

## Checklist (verification)

- [x] All cluster-scoped paths validate `clusterId`.
- [x] Resource paths validate `kind`, `namespace`, `name` where applicable.
- [x] SecureHeaders middleware applied globally.
- [x] Delete resource requires `X-Confirm-Destructive: true`.
- [x] Apply manifest requires `X-Confirm-Destructive: true` and is size-limited.
- [x] Frontend sends confirm header only after user confirmation (DeleteConfirmDialog, apply review).
