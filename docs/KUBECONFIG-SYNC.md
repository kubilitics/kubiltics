# Kubeconfig Sync

Kubilitics auto-removes clusters from its SQLite registry when their
kubeconfig context is deleted externally (via `kind delete cluster`,
`kubectl config delete-context`, or editing the file). This keeps the
Fleet page in sync with the user's actual kubeconfig without manual
cleanup.

> **UI-side companion (Phase 6, 2026-04-24):** the frontend surfaces
> discovered kubeconfig contexts as cards on the `/clusters` picker the
> moment the user opens Kubilitics. The old `/connect` page is deprecated.
> Sync still runs on the backend exactly as described below — the picker
> consumes `GET /api/v1/presence` (and subscribes to
> `/api/v1/presence/events` SSE) as its source of truth.

The feature is modeled on [Headlamp's kubeconfig watcher](https://github.com/headlamp-k8s/headlamp/blob/main/backend/pkg/kubeconfig/watcher.go)
and is hardened with several enterprise safety mechanisms. It is
enabled by default for desktop and browser deployments and
automatically disabled in in-cluster (Helm) mode.

## Configuration

All settings are env-var or yaml-key addressable:

| Env var                                                 | Yaml key                                    | Default | Meaning |
|---------------------------------------------------------|---------------------------------------------|---------|---------|
| `KUBILITICS_KUBECONFIG_SYNC_ENABLED`                    | `kubeconfig_sync_enabled`                   | `true`  | Master kill switch. Set to `false` to disable the watcher entirely. |
| `KUBILITICS_KUBECONFIG_SYNC_HEALTH_INTERVAL_SEC`        | `kubeconfig_sync_health_interval_sec`       | `10`    | Watch-health check cadence. Low cost — re-adds broken fsnotify watches after file renames. |
| `KUBILITICS_KUBECONFIG_SYNC_POLL_INTERVAL_SEC`          | `kubeconfig_sync_poll_interval_sec`         | `60`    | Polling fallback cadence. A full sync runs every N seconds regardless of fsnotify — necessary for NFS, overlayfs, WSL2, and any filesystem where fsnotify doesn't fire events. |
| `KUBILITICS_KUBECONFIG_SYNC_MAX_ABSOLUTE_REMOVALS`      | `kubeconfig_sync_max_absolute_removals`     | `10`    | Safety cap: if a single sync pass would remove >= N clusters, abort with a loud warning + audit entry. |
| `KUBILITICS_KUBECONFIG_SYNC_MAX_REMOVAL_RATIO`          | `kubeconfig_sync_max_removal_ratio`         | `0.5`   | Safety cap: if a single sync pass would remove > N of kubeconfig-sourced clusters (as a ratio), abort. Valid range: (0, 1]. Default 0.5 means "refuse to remove more than half." |
| `KUBILITICS_DEPLOYMENT_MODE`                            | `deployment_mode`                           | auto    | `desktop`, `browser`, or `in-cluster`. Auto-detected from `KUBERNETES_SERVICE_HOST` and `TAURI_ENABLED`. |

## Which clusters are eligible for auto-removal?

Only clusters with `source='kubeconfig'`. Clusters added via the
"upload kubeconfig" flow have `source='upload'` and are never
auto-removed — their source of truth is the Kubilitics-managed file
under `~/.kubilitics/kubeconfigs/`, not the user's system kubeconfig.

## Safety mechanisms

1. **Fail-safe reads.** If a kubeconfig file can't be read or parsed,
   the sync aborts with zero mutations. Transient errors delay
   convergence; they never cause false deletions.

2. **Mass-delete safety cap.** The absolute and ratio thresholds
   above ensure a single errant edit can't wipe a fleet. When the
   cap triggers, an audit entry `cluster_sync_safety_cap_triggered`
   is written with the orphan list, and the user must delete via
   the UI if they really meant it.

3. **Pre-destructive snapshots.** Before any removal pass, Kubilitics
   writes a redacted JSON snapshot of the entire cluster table to
   `~/.kubilitics/snapshots/clusters-pre-sync-<ISO8601>.json`. The
   newest 10 snapshots are retained; older ones are pruned. Snapshots
   contain only metadata — no credentials, no kubeconfig contents.

4. **Audit log.** Every auto-removal produces a `cluster_auto_removed`
   audit entry in the `audit_log` SQLite table with reason, trigger,
   watched paths, and the removed context name. Entries are
   append-only.

## Recovering a cluster that was removed incorrectly

If a sync pass removed a cluster that shouldn't have been removed,
use the pre-destructive snapshot to restore it:

```bash
# List available snapshots
ls -lt ~/.kubilitics/snapshots/

# Restore from the snapshot taken just before the bad sync
kubilitics-backend restore-snapshot \
    ~/.kubilitics/snapshots/clusters-pre-sync-2026-04-14T10-30-00Z.json
```

Restore is strictly additive: clusters already present in the DB
(matched by ID) are skipped, never overwritten. Re-running restore
on the same snapshot is idempotent.

## How sync gets triggered

The watcher combines three trigger sources, all coalesced through
a single singleflight group so concurrent triggers run the sync
exactly once:

- **`fsnotify_event`**: inotify/FSEvents/ReadDirectoryChangesW
  fires on `Create | Write | Remove | Rename` of any watched file.
  Near-instant — typically under 50 ms after the file change.
- **`health_ticker`**: every `KUBILITICS_KUBECONFIG_SYNC_HEALTH_INTERVAL_SEC`
  seconds, the watcher verifies its fsnotify watch list is still
  intact. If a watch broke (common after atomic file replace),
  the watcher re-adds the path AND runs a sync to catch up.
- **`poll_fallback`**: every `KUBILITICS_KUBECONFIG_SYNC_POLL_INTERVAL_SEC`
  seconds, the watcher runs a full sync regardless of fsnotify
  activity. This is the safety net for filesystems where fsnotify
  doesn't fire events (NFS, overlayfs, WSL2 cross-boundary mounts).
- **`startup`**: the watcher runs a one-shot sync immediately when
  Kubilitics starts, so the registry converges on any changes made
  while the backend was offline.

## Disabling the feature

Set `KUBILITICS_KUBECONFIG_SYNC_ENABLED=false` and restart the
backend. The watcher will not start; no clusters will be auto-removed.
The feature can be re-enabled later without any state rollback —
the SQLite registry is preserved regardless.
