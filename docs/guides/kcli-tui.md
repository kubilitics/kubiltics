# kcli TUI User Guide

**Audience:** Kubernetes operators, developers
**Applies to:** kcli v0.1.1+
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Overview](#1-overview)
2. [Launching the TUI](#2-launching-the-tui)
3. [Keyboard Shortcuts](#3-keyboard-shortcuts)
4. [Multi-Cluster Switching](#4-multi-cluster-switching)
5. [Resource Navigation](#5-resource-navigation)
6. [Resource Detail Panel](#6-resource-detail-panel)
7. [Log Streaming](#7-log-streaming)
8. [AI-Powered Commands](#8-ai-powered-commands)
9. [Configuration](#9-configuration)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

kcli is an AI-powered kubectl replacement that includes a terminal user interface (TUI) for interactive Kubernetes cluster management. The TUI provides a real-time, navigable view of cluster resources with keyboard-driven workflows.

### Features

- Real-time resource listing with automatic refresh
- Multi-cluster context switching
- Resource detail panel with YAML view
- Log streaming for pods and containers
- AI-assisted troubleshooting inline
- Namespace filtering
- Resource search and filtering

---

## 2. Launching the TUI

```bash
# Launch with default kubeconfig context
kcli tui

# Launch with specific context
kcli tui --context production

# Launch with specific namespace
kcli tui --namespace kube-system

# Launch with specific resource type
kcli tui --resource pods

# Launch with custom refresh interval (default: 5s)
kcli tui --refresh 10s

# Connect to Kubilitics backend for enhanced features
kcli tui --backend http://localhost:8080
```

---

## 3. Keyboard Shortcuts

### Global

| Key | Action |
|---|---|
| `?` | Show help / keyboard shortcuts overlay |
| `q` / `Ctrl+C` | Quit kcli TUI |
| `Esc` | Close panel / dialog / cancel |
| `:` | Open command palette |
| `/` | Open search / filter bar |
| `Tab` | Cycle focus between panels |
| `Shift+Tab` | Cycle focus backward |
| `Ctrl+L` | Redraw / refresh screen |
| `Ctrl+R` | Force refresh data |

### Navigation

| Key | Action |
|---|---|
| `j` / `Down` | Move cursor down |
| `k` / `Up` | Move cursor up |
| `h` / `Left` | Collapse / go to parent |
| `l` / `Right` | Expand / go to detail |
| `g` | Go to first row |
| `G` | Go to last row |
| `Ctrl+D` | Page down |
| `Ctrl+U` | Page up |
| `Enter` | Open detail panel for selected resource |

### Resource Operations

| Key | Action |
|---|---|
| `d` | Describe resource (opens detail panel) |
| `e` | Edit resource (opens `$EDITOR`) |
| `y` | View YAML in detail panel |
| `L` | Stream logs (pods only) |
| `x` | Exec into container (pods only) |
| `Delete` | Delete resource (with confirmation) |
| `s` | Scale resource (deployments, statefulsets, replicasets) |
| `r` | Restart rollout (deployments, statefulsets, daemonsets) |

### Filtering and Search

| Key | Action |
|---|---|
| `/` | Open search bar |
| `n` | Next search match |
| `N` | Previous search match |
| `Ctrl+N` | Switch namespace |
| `Ctrl+K` | Switch cluster context |
| `1`-`9` | Quick-switch to resource type (1=Pods, 2=Deployments, etc.) |

### Detail Panel

| Key | Action |
|---|---|
| `Esc` | Close detail panel |
| `Tab` | Switch between detail tabs (Info, YAML, Events, Logs) |
| `c` | Copy selected value to clipboard |
| `w` | Toggle word wrap |
| `Ctrl+S` | Save YAML to file |

### Log Streaming

| Key | Action |
|---|---|
| `f` | Toggle follow mode (auto-scroll) |
| `p` | Pause / resume log stream |
| `Ctrl+F` | Search within logs |
| `t` | Toggle timestamps |
| `Ctrl+W` | Toggle line wrap |
| `[` / `]` | Switch container (multi-container pods) |
| `Ctrl+S` | Save logs to file |

---

## 4. Multi-Cluster Switching

### Context Picker

Press `Ctrl+K` to open the cluster context picker:

```
┌─ Switch Context ─────────────────────────────┐
│ Search: _                                      │
│                                                │
│ > production    (aws/us-east-1/prod-cluster)   │
│   staging       (aws/us-east-1/stage-cluster)  │
│   development   (local/minikube)               │
│   gke-europe    (gcp/europe-west1/gke-prod)    │
│                                                │
│ [Enter] Switch  [Esc] Cancel  [/] Search       │
└────────────────────────────────────────────────┘
```

### Behavior

- Context switching is instant -- kcli reuses existing kubeconfig contexts.
- The current context is displayed in the status bar at the bottom of the TUI.
- Resource listings refresh automatically after switching.
- If the Kubilitics backend is connected, clusters registered in Kubilitics are also listed.

### Kubeconfig Merge

kcli reads all kubeconfig files from:
1. `$KUBECONFIG` (colon-separated list)
2. `~/.kube/config`
3. `~/.kube/config.d/*.yaml` (if the directory exists)

Contexts from all files are merged and deduplicated.

---

## 5. Resource Navigation

### Resource Type Selector

The left sidebar shows resource categories:

```
┌─ Resources ──────┐
│ Workloads        │
│  > Pods          │
│    Deployments   │
│    StatefulSets  │
│    DaemonSets    │
│    Jobs          │
│    CronJobs      │
│ Network          │
│    Services      │
│    Ingresses     │
│    Endpoints     │
│    NetworkPols   │
│ Storage          │
│    PVCs          │
│    PVs           │
│    StorageClass  │
│ Config           │
│    ConfigMaps    │
│    Secrets       │
│ RBAC             │
│    Roles         │
│    Bindings      │
│    ServiceAccts  │
│ Cluster          │
│    Nodes         │
│    Namespaces    │
│    Events        │
│    CRDs          │
└──────────────────┘
```

### Quick Filters

| Key | Resource Type |
|---|---|
| `1` | Pods |
| `2` | Deployments |
| `3` | Services |
| `4` | ConfigMaps |
| `5` | Secrets |
| `6` | Ingresses |
| `7` | Nodes |
| `8` | Namespaces |
| `9` | Events |

### Namespace Filtering

Press `Ctrl+N` to open the namespace picker. Select `All Namespaces` or a specific namespace. The active namespace filter is shown in the status bar.

### Column Sorting

Press the column header letter (shown in brackets) to sort:

```
NAME         [n]  READY  [r]  STATUS  [s]  RESTARTS  [t]  AGE  [a]  NODE  [o]
nginx-abc    1/1  Running      0           15m   worker-1
redis-xyz    1/1  Running      2           3h    worker-2
```

---

## 6. Resource Detail Panel

Press `Enter` or `d` on a selected resource to open the detail panel on the right side.

### Detail Panel Tabs

#### Info Tab
Displays key-value pairs:
- Metadata: name, namespace, UID, creation timestamp, labels, annotations
- Status: phase, conditions, container statuses
- Spec highlights: image, ports, volumes, resource requests/limits

#### YAML Tab
Full resource YAML with syntax highlighting. Press `e` to edit in `$EDITOR`.

#### Events Tab
Kubernetes events associated with the resource, sorted by last timestamp:
```
TYPE      REASON    AGE   MESSAGE
Normal    Pulling   5m    Pulling image "nginx:1.25"
Normal    Pulled    4m    Successfully pulled image
Normal    Created   4m    Created container nginx
Normal    Started   4m    Started container nginx
```

#### Logs Tab (Pods only)
Live log stream from the selected container. See [Log Streaming](#7-log-streaming).

### Panel Sizing

- Default: 50% width
- Press `>` to expand, `<` to shrink
- Press `Ctrl+\` to toggle full-screen detail

---

## 7. Log Streaming

### Accessing Logs

1. Select a pod in the resource list.
2. Press `L` to open log streaming, or press `Enter` then navigate to the Logs tab.

### Multi-Container Pods

For pods with multiple containers, kcli shows a container picker:

```
┌─ Select Container ──────────────────┐
│ > nginx        (running)            │
│   sidecar-proxy (running)           │
│   init-db       (terminated: 0)     │
│                                     │
│ [Enter] Select  [a] All containers  │
└─────────────────────────────────────┘
```

Press `a` to merge logs from all containers (interleaved by timestamp).

### Log Options

| Option | Key | Description |
|---|---|---|
| Follow | `f` | Auto-scroll to newest logs |
| Timestamps | `t` | Show/hide RFC 3339 timestamps |
| Previous | `P` | Show logs from previous container instance |
| Since | `S` | Set time-based log window (e.g., `5m`, `1h`, `24h`) |
| Lines | `Ctrl+G` | Set tail line count (default: 1000) |
| Wrap | `Ctrl+W` | Toggle line wrapping |

### Log Search

Press `Ctrl+F` within the log view to search:
- Supports plain text and regex patterns
- Matches are highlighted
- Press `n` / `N` to navigate between matches

### Saving Logs

Press `Ctrl+S` to save the current log buffer to a file:
```
Save logs to: /tmp/nginx-abc-logs-2026-03-16.txt
```

---

## 8. AI-Powered Commands

When connected to the Kubilitics AI backend (`kcli tui --backend http://localhost:8080`), the following AI features are available:

### Command Palette AI

Press `:` to open the command palette and type natural language:

```
: why is my pod crashing?
: show me pods using more than 500Mi memory
: what services route to the nginx deployment?
: explain the network policy for namespace production
```

### Inline Troubleshooting

When viewing a pod in CrashLoopBackOff or Error state, press `Ctrl+A` to get an AI-generated diagnosis:

```
┌─ AI Analysis ────────────────────────────────────────────┐
│ Pod nginx-abc is in CrashLoopBackOff                     │
│                                                          │
│ Root cause: OOMKilled (exit code 137)                    │
│ The container was killed because it exceeded its memory   │
│ limit of 128Mi. Recent logs show memory usage growing    │
│ to 140Mi before termination.                             │
│                                                          │
│ Suggested fix:                                           │
│   kubectl set resources deployment/nginx                 │
│     --limits=memory=256Mi                                │
│                                                          │
│ [Enter] Apply fix  [c] Copy command  [Esc] Dismiss       │
└──────────────────────────────────────────────────────────┘
```

---

## 9. Configuration

### Configuration File

kcli TUI settings are stored in `~/.config/kcli/tui.yaml`:

```yaml
# TUI configuration
tui:
  # Refresh interval for resource listings
  refreshInterval: 5s

  # Default resource type to show on launch
  defaultResource: pods

  # Default namespace (empty = all namespaces)
  defaultNamespace: ""

  # Theme: "dark", "light", "auto" (follows terminal)
  theme: auto

  # Color scheme for health indicators
  colors:
    healthy: green
    warning: yellow
    error: red
    unknown: gray

  # Log streaming defaults
  logs:
    tailLines: 1000
    follow: true
    timestamps: false
    wrapLines: false

  # Panel layout
  layout:
    sidebarWidth: 20       # columns
    detailPanelRatio: 50   # percent

  # Key bindings (override defaults)
  keyBindings: {}

  # Kubilitics backend URL (empty = standalone mode)
  backendURL: ""

  # Editor for YAML editing (default: $EDITOR or vi)
  editor: ""
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `KCLI_TUI_THEME` | Theme override | `auto` |
| `KCLI_TUI_REFRESH` | Refresh interval | `5s` |
| `KCLI_BACKEND_URL` | Kubilitics backend URL | (empty) |
| `EDITOR` | Editor for YAML editing | `vi` |
| `KUBECONFIG` | Kubeconfig path(s) | `~/.kube/config` |

---

## 10. Troubleshooting

### TUI renders incorrectly

- Ensure your terminal supports 256 colors or true color.
- Try `TERM=xterm-256color kcli tui`.
- Minimum terminal size: 80 columns x 24 rows.

### Context switching is slow

- Check kubeconfig for stale contexts pointing to unreachable clusters.
- Set `KUBILITICS_K8S_TIMEOUT_SEC=5` to reduce API timeout.

### Logs are empty

- Verify the pod has logs: `kubectl logs <pod>`.
- Check RBAC: the service account needs `pods/log` read access.
- For init containers or terminated containers, press `P` for previous logs.

### High CPU usage

- Increase the refresh interval: `kcli tui --refresh 30s`.
- Reduce tail lines for log streaming.
- Filter to a specific namespace instead of watching all namespaces.

### Key bindings not working

- Check for terminal key interception (especially `Ctrl+S`, `Ctrl+Q` flow control).
- Run `stty -ixon` to disable XON/XOFF flow control.
- Verify no tmux/screen key conflicts.
