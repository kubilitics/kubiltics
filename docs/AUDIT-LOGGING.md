# Audit Logging (C3.3)

## Scope

Mutating operations are audited:

- **Delete:** DELETE `/api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}` — logs request_id, cluster_id, kind, namespace, name, outcome (success/failure), and on failure the error message.
- **Apply:** POST `/api/v1/clusters/{clusterId}/apply` — logs request_id, cluster_id, outcome (success/failure), and on success the list of applied resources (kind, namespace, name, action: created/updated). No secret or YAML content is logged.

## Format

Audit events are written to **stderr** as JSON lines (same as request logs). Each event has:

- `time` — ISO8601
- `action` — `"delete"` or `"apply"`
- `request_id` — from `X-Request-ID` (correlates with request log)
- `cluster_id` — target cluster
- For delete: `kind`, `namespace`, `name`, `outcome`, `message`
- For apply: `outcome`, `message`, `resources` (array of { kind, namespace, name, action })

Example (delete success):

```json
{"time":"2026-02-04T12:00:00Z","action":"delete","request_id":"abc-123","cluster_id":"c1","kind":"Pod","namespace":"default","name":"nginx","outcome":"success"}
```

## Retention

- **Current:** Audit events are written to the process stderr. Retention is determined by how the process is run (e.g. systemd, Docker, Kubernetes). There is no built-in retention limit or rotation in the application.
- **Recommended:** Configure log aggregation (e.g. Loki, Elasticsearch) to ingest stderr and apply retention (e.g. 90 days). Export for compliance by querying the audit index. For strict compliance, consider persisting audit events to a dedicated store (e.g. S3, database) with a retention policy and export API.

## Implementation

- `internal/pkg/audit`: `LogDelete`, `LogApply`; events are logged via `slog` in JSON.
- Handlers call audit after delete/apply (success or failure) with request ID from context.
