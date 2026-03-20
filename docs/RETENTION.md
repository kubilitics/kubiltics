# Retention Strategies (D1.3)

## Overview

This document describes retention for audit logs, topology snapshots, resource history, and metrics. Adjust retention and archival to match compliance and operational requirements.

## Audit logs

| Item | Location | Default retention | Deletion / archival |
|------|----------|-------------------|----------------------|
| Delete events | stderr (JSON lines) | Process lifecycle | By log aggregator (e.g. 90 days in Loki/ELK); rotate or truncate by host policy. |
| Apply events | stderr (JSON lines) | Process lifecycle | Same as above. |

- **No built-in retention in app:** The backend writes audit events to stderr only. Retention is the responsibility of the logging pipeline (log shipper, central store, retention policy).
- **Recommendation:** Configure your log aggregator to retain audit logs for at least 90 days (or per compliance); export for compliance on demand.

## Topology snapshots

| Item | Location | Default retention | Deletion / archival |
|------|----------|-------------------|----------------------|
| In-memory cache | `topologycache` | TTL only (e.g. 30s) | Evicted on TTL or invalidation; no persistent snapshot. |
| Persisted snapshots (if implemented) | DB table e.g. `topology_snapshots` | Configurable | Repository method e.g. `DeleteTopologySnapshotsOlderThan(clusterID, time)`; run periodically (cron or scheduler). |

- **Current behavior:** Topology is computed on demand and cached in memory with TTL. There is no long-lived topology snapshot storage in the default setup.
- **If you add snapshot persistence:** Define a retention window (e.g. 7 or 30 days) and run a job to delete or archive snapshots older than that.

## Resource history

| Item | Location | Default retention | Deletion / archival |
|------|----------|-------------------|----------------------|
| Resource versions | Kubernetes API server | Per K8s cluster config | Handled by the cluster (history limit per resource). |
| Backend-side history | Not stored today | N/A | Backend does not store resource history; it proxies to K8s. |

- **Recommendation:** Rely on Kubernetes’ own history limits; for long-term history, use a separate solution (e.g. audit sink, snapshot/backup tool).

## Metrics

| Item | Location | Default retention | Deletion / archival |
|------|----------|-------------------|----------------------|
| Prometheus metrics | `/metrics` endpoint | Scrape interval only in backend | Retention is in Prometheus (or your metrics backend); e.g. 15d–30d typical. |
| Metrics Server (CPU/memory) | K8s Metrics Server | Per cluster | Short TTL in memory; no long-term retention in backend. |

- **Recommendation:** Configure Prometheus (or equivalent) retention (e.g. 15–30 days); for long-term analytics, use downsampling or an external data lake.

## Retention matrix (summary)

| Data type | Stored where | Who retains | Typical retention |
|-----------|--------------|-------------|--------------------|
| Audit logs (delete/apply) | stderr → log pipeline | Log aggregator | 90 days (configurable) |
| Topology cache | Memory | App (TTL) | Seconds to minutes |
| Topology snapshots (if persisted) | DB | App or job | 7–30 days (configurable) |
| Resource history | K8s API | Cluster | Per cluster config |
| Prometheus metrics | Scrape target | Prometheus | 15–30 days |

## Deletion and archival

- **Audit logs:** Deletion/archival is done by the log pipeline (e.g. delete after 90 days or move to cold storage).
- **Topology snapshots (DB):** If implemented, add a scheduled task or admin API to call repository delete for snapshots older than X days.
- **Metrics:** Retention and archival are configured in Prometheus or your metrics backend.
