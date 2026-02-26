// Package metrics provides Prometheus metrics for the Kubilitics add-on platform.
// All metrics use the "kubilitics" namespace and are registered with the default
// Prometheus registry via promauto, so they are automatically scraped on /metrics.
//
// RED pattern for install/upgrade/rollback operations:
//   - Rate:   addon_installs_total, addon_upgrades_total, addon_rollbacks_total
//   - Errors: the "failed" label value of the above counters
//   - Duration: addon_operation_duration_seconds
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

const namespace = "kubilitics"

var (
	// AddonInstallsTotal counts add-on install operations by addon_id and outcome.
	// outcome: success | failed
	AddonInstallsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "installs_total",
			Help:      "Total number of add-on install operations by addon_id and outcome.",
		},
		[]string{"addon_id", "outcome"},
	)

	// AddonUpgradesTotal counts add-on upgrade operations by addon_id and outcome.
	AddonUpgradesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "upgrades_total",
			Help:      "Total number of add-on upgrade operations by addon_id and outcome.",
		},
		[]string{"addon_id", "outcome"},
	)

	// AddonRollbacksTotal counts add-on rollback operations by addon_id and outcome.
	AddonRollbacksTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "rollbacks_total",
			Help:      "Total number of add-on rollback operations by addon_id and outcome.",
		},
		[]string{"addon_id", "outcome"},
	)

	// AddonUninstallsTotal counts add-on uninstall operations by addon_id and outcome.
	AddonUninstallsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "uninstalls_total",
			Help:      "Total number of add-on uninstall operations by addon_id and outcome.",
		},
		[]string{"addon_id", "outcome"},
	)

	// AddonOperationDurationSeconds tracks end-to-end operation latency by operation type.
	// operation: install | upgrade | rollback | uninstall | preflight | dry_run
	AddonOperationDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "operation_duration_seconds",
			Help:      "Duration of add-on lifecycle operations in seconds.",
			// Buckets: 1s → 2s → 4s → 8s → 16s → 32s → 64s → 128s → 256s → 512s
			Buckets: prometheus.ExponentialBuckets(1, 2, 10),
		},
		[]string{"operation", "addon_id"},
	)

	// AddonPreflightTotal counts preflight runs by addon_id and result.
	// result: go | warn | block | error
	AddonPreflightTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "preflight_checks_total",
			Help:      "Total number of add-on preflight checks by addon_id and result.",
		},
		[]string{"addon_id", "result"},
	)

	// LMCHealthChecksTotal counts Lifecycle Monitor Controller (LMC) health ticks by cluster and result.
	// result: healthy | degraded | unknown | error
	LMCHealthChecksTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "lmc_health_checks_total",
			Help:      "Total number of LMC health check evaluations by cluster_id and result.",
		},
		[]string{"cluster_id", "result"},
	)

	// DriftDetectedTotal counts drift detection events by cluster_id and severity.
	// severity: cosmetic | structural | destructive
	DriftDetectedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "drift_detected_total",
			Help:      "Total number of configuration drift events detected by cluster_id and severity.",
		},
		[]string{"cluster_id", "severity"},
	)

	// AddonCatalogSize tracks the current number of entries in the add-on catalog.
	AddonCatalogSize = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "addon",
			Name:      "catalog_size",
			Help:      "Current number of add-on entries in the catalog registry.",
		},
	)
)
