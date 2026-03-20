# Secrets Handling (C3.2)

## API and logs

- **Secret resources:** List and Get for Kubernetes `Secret` resources **redact** `.data` and `.stringData` values before returning. Key names are preserved; values are replaced with `***REDACTED***`. Implemented in `internal/pkg/redact` and used in `internal/api/rest/resources.go` for list and get when kind is Secret.
- **Logs:** Structured logs (request log, audit log) do not include request/response bodies or any secret values. No kubeconfig paths or tokens are logged. Logger package and middleware are designed to avoid PII and secrets.

## Storage

- **Kubeconfig paths:** Cluster records in the database store `kubeconfig_path` and `context` as configured by the user. The backend reads kubeconfig from disk at runtime; it does not store raw kubeconfig or token contents in the DB. For production, consider storing only a reference (e.g. path or secret name) and loading credentials from a secure store (e.g. keychain, vault).
- **Encryption at rest:** SQLite/Postgres database files may contain paths and metadata. For high-security environments, use encrypted storage (e.g. encrypted volume, or application-level encryption of sensitive fields) and restrict file permissions.

## Checklist

- [x] Secret list/get responses redact `.data` and `.stringData` values.
- [x] No secret values in structured logs or audit log payloads.
- [x] No kubeconfig or token contents stored in application logs.
- [ ] Optional: YAML view in UI redacts Secret values (frontend can apply same rule when rendering).
- [ ] Optional: Kubeconfig/tokens in keychain or encrypted DB (desktop/enterprise).
