package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// veleroBackupsGVR is the GroupVersionResource for Velero backup objects.
var veleroBackupsGVR = schema.GroupVersionResource{
	Group:    "velero.io",
	Version:  "v1",
	Resource: "backups",
}

// veleroNamespace is the conventional namespace where Velero is deployed.
const veleroNamespace = "velero"

// veleroIsInstalled probes the cluster for the Velero backups CRD by attempting
// a List with limit=1. If the API server returns any error (NotFound, no kind
// registered, etc.) Velero is considered absent.
func veleroIsInstalled(ctx context.Context, dc dynamic.Interface) bool {
	tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := dc.Resource(veleroBackupsGVR).Namespace(veleroNamespace).List(tctx, metav1.ListOptions{Limit: 1})
	return err == nil
}

// createVeleroBackup creates a velero.io/v1 Backup covering namespace and polls
// until the backup reaches phase Completed (or times out / fails).
// It returns the backup name so callers can store it in the audit trail.
//
// If the backup phase becomes Failed or PartiallyFailed the error is non-nil,
// but the returned backupName is still set — callers should decide whether to
// treat this as a hard blocker or a warning and continue with the upgrade.
func createVeleroBackup(
	ctx context.Context,
	dc dynamic.Interface,
	releaseName, namespace string,
	timeout time.Duration,
	logger *slog.Logger,
) (backupName string, err error) {
	ts := time.Now().UTC().Format("20060102-150405")
	backupName = fmt.Sprintf("kubilitics-%s-%s", releaseName, ts)

	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "velero.io/v1",
			"kind":       "Backup",
			"metadata": map[string]interface{}{
				"name":      backupName,
				"namespace": veleroNamespace,
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "kubilitics",
					"kubilitics.io/release":        releaseName,
				},
			},
			"spec": map[string]interface{}{
				// Capture only the addon's namespace to keep backups small and fast.
				"includedNamespaces": []interface{}{namespace},
				// 30-day retention; most recent backup is always kept until superseded.
				"ttl":             "720h0m0s",
				"storageLocation": "default",
			},
		},
	}

	if _, createErr := dc.Resource(veleroBackupsGVR).Namespace(veleroNamespace).Create(
		ctx, obj, metav1.CreateOptions{},
	); createErr != nil {
		return "", fmt.Errorf("create velero backup %s: %w", backupName, createErr)
	}

	logger.Info("velero backup created; polling for completion",
		"backup_name", backupName,
		"source_namespace", namespace,
		"timeout", timeout,
	)

	const pollInterval = 5 * time.Second
	deadline := time.Now().Add(timeout)

	for {
		if time.Now().After(deadline) {
			return backupName, fmt.Errorf("velero backup %s did not complete within %s", backupName, timeout)
		}

		pollCtx, pollCancel := context.WithTimeout(ctx, 10*time.Second)
		got, getErr := dc.Resource(veleroBackupsGVR).Namespace(veleroNamespace).Get(
			pollCtx, backupName, metav1.GetOptions{},
		)
		pollCancel()

		if getErr != nil {
			logger.Warn("velero backup poll error", "backup_name", backupName, "err", getErr)
		} else {
			phase, _, _ := unstructured.NestedString(got.Object, "status", "phase")
			switch phase {
			case "Completed":
				logger.Info("velero backup completed", "backup_name", backupName)
				return backupName, nil
			case "Failed", "PartiallyFailed":
				return backupName, fmt.Errorf("velero backup %s reached phase %s", backupName, phase)
			}
			// InProgress, New, "" — keep polling.
		}

		select {
		case <-ctx.Done():
			return backupName, ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}
