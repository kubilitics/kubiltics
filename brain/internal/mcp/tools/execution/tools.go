package execution

// Package execution provides Tier 4 execution tools for the LLM.
//
// CRITICAL CONSTRAINT: EVERY execution tool MUST pass through the Safety Engine
// before executing any cluster mutation. If the safety check fails or requires
// human approval, the operation is NOT executed.
//
// Implemented tools (A-CORE-004):
//   restart_pod, scale_deployment, cordon_node, drain_node,
//   apply_resource_patch, delete_resource, rollback_deployment,
//   update_resource_limits, trigger_hpa_scale

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/vellankikoti/kubilitics/brain/internal/audit"
	"github.com/vellankikoti/kubilitics/brain/internal/safety"
)

// HTTPExecutor abstracts REST calls to the kubilitics-backend API.
// The three methods map to the three HTTP verbs used by execution tools.
type HTTPExecutor interface {
	Post(ctx context.Context, path string, body interface{}) (map[string]interface{}, int, error)
	Patch(ctx context.Context, path string, body interface{}) (map[string]interface{}, int, error)
	Delete(ctx context.Context, path string, headers map[string]string) (map[string]interface{}, int, error)
}

// SafetyEvaluator enables test injection for the safety engine.
type SafetyEvaluator interface {
	EvaluateAction(ctx context.Context, action *safety.Action) (*safety.SafetyResult, error)
}

// ExecutionTools holds all execution tool implementations.
type ExecutionTools struct {
	http     HTTPExecutor
	safety   SafetyEvaluator
	auditLog audit.Logger
}

// NewExecutionTools creates a new ExecutionTools instance using the backend base URL.
func NewExecutionTools(backendBaseURL string, safetyEngine *safety.Engine, auditLog audit.Logger) *ExecutionTools {
	return NewExecutionToolsWithDeps(newDefaultHTTPExecutor(backendBaseURL), safetyEngine, auditLog)
}

// NewExecutionToolsWithDeps creates a new ExecutionTools instance with injected
// dependencies (used in tests).
func NewExecutionToolsWithDeps(httpExec HTTPExecutor, safetyEval SafetyEvaluator, auditLog audit.Logger) *ExecutionTools {
	return &ExecutionTools{
		http:     httpExec,
		safety:   safetyEval,
		auditLog: auditLog,
	}
}

// HandlerMap returns all tool handlers keyed by tool name.
func (t *ExecutionTools) HandlerMap() map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	return map[string]func(ctx context.Context, args map[string]interface{}) (interface{}, error){
		"restart_pod":            t.RestartPod,
		"scale_deployment":       t.ScaleDeployment,
		"cordon_node":            t.CordonNode,
		"drain_node":             t.DrainNode,
		"apply_resource_patch":   t.ApplyResourcePatch,
		"delete_resource":        t.DeleteResource,
		"rollback_deployment":    t.RollbackDeployment,
		"update_resource_limits": t.UpdateResourceLimits,
		"trigger_hpa_scale":      t.TriggerHPAScale,
	}
}

// ─── safetyCheck is the common safety gate ────────────────────────────────────

func (t *ExecutionTools) safetyCheck(
	ctx context.Context,
	operation, kind, namespace, name, justification string,
	targetState map[string]interface{},
) (*safety.SafetyResult, error) {
	action := &safety.Action{
		ID:            audit.GenerateCorrelationID(),
		Operation:     operation,
		ResourceType:  kind,
		ResourceName:  name,
		Namespace:     namespace,
		TargetState:   targetState,
		Justification: justification,
		Timestamp:     time.Now(),
	}
	return t.safety.EvaluateAction(ctx, action)
}

func safetyDenied(result *safety.SafetyResult) (interface{}, error) {
	return map[string]interface{}{
		"approved":       false,
		"reason":         result.Reason,
		"risk_level":     result.RiskLevel,
		"requires_human": result.RequiresHuman,
		"policy_checks":  result.PolicyChecks,
	}, nil
}

// ─── restart_pod (Autonomy Level 2) ───────────────────────────────────────────

type restartPodArgs struct {
	ClusterID     string `json:"cluster_id,omitempty"`
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	Justification string `json:"justification,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

// RestartPod deletes a pod to trigger a restart (Level 2 — semi-autonomous).
// Uses DELETE /api/v1/clusters/{clusterId}/resources/pods/{namespace}/{name}
func (t *ExecutionTools) RestartPod(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a restartPodArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("restart_pod: invalid args: %w", err)
	}
	if a.Namespace == "" || a.Name == "" {
		return nil, fmt.Errorf("restart_pod: namespace and name are required")
	}

	result, err := t.safetyCheck(ctx, "restart", "Pod", a.Namespace, a.Name, a.Justification, nil)
	if err != nil {
		return nil, fmt.Errorf("restart_pod: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":   true,
			"approved":  true,
			"pod":       a.Name,
			"namespace": a.Namespace,
			"message":   "DRY RUN: Pod would be deleted to trigger restart",
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/pods/%s/%s",
		clusterID, a.Namespace, a.Name)
	resp, status, err := t.http.Delete(ctx, path, map[string]string{
		"X-Confirm-Destructive": "true",
	})
	if err != nil {
		return nil, fmt.Errorf("restart_pod: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Restarted pod %s/%s", a.Namespace, a.Name)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved":  true,
		"pod":       a.Name,
		"namespace": a.Namespace,
		"success":   status < 300,
		"message":   responseMessage(resp, status),
	}, nil
}

// ─── scale_deployment (Autonomy Level 3) ──────────────────────────────────────

type scaleDeploymentArgs struct {
	ClusterID     string `json:"cluster_id,omitempty"`
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	Replicas      int    `json:"replicas"`
	Justification string `json:"justification,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

// ScaleDeployment changes the replica count of a deployment (Level 3).
// Uses PATCH /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}
func (t *ExecutionTools) ScaleDeployment(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a scaleDeploymentArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("scale_deployment: invalid args: %w", err)
	}
	if a.Namespace == "" || a.Name == "" {
		return nil, fmt.Errorf("scale_deployment: namespace and name are required")
	}
	if a.Replicas < 0 {
		return nil, fmt.Errorf("scale_deployment: replicas must be >= 0")
	}

	result, err := t.safetyCheck(ctx, "scale", "Deployment", a.Namespace, a.Name, a.Justification,
		map[string]interface{}{"replicas": a.Replicas})
	if err != nil {
		return nil, fmt.Errorf("scale_deployment: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":   true,
			"approved":  true,
			"name":      a.Name,
			"namespace": a.Namespace,
			"replicas":  a.Replicas,
			"message":   fmt.Sprintf("DRY RUN: Deployment %s would be scaled to %d replicas", a.Name, a.Replicas),
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/Deployment/%s/%s",
		clusterID, a.Namespace, a.Name)
	resp, status, err := t.http.Patch(ctx, path, map[string]interface{}{
		"spec": map[string]interface{}{"replicas": a.Replicas},
	})
	if err != nil {
		return nil, fmt.Errorf("scale_deployment: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Scaled deployment %s/%s to %d replicas", a.Namespace, a.Name, a.Replicas)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved":  true,
		"name":      a.Name,
		"namespace": a.Namespace,
		"replicas":  a.Replicas,
		"success":   status < 300,
		"message":   responseMessage(resp, status),
	}, nil
}

// ─── cordon_node (Autonomy Level 3) ───────────────────────────────────────────

type cordonNodeArgs struct {
	ClusterID     string `json:"cluster_id,omitempty"`
	Name          string `json:"name"`
	Justification string `json:"justification,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

// CordonNode marks a node as unschedulable (Level 3).
// Uses POST /api/v1/clusters/{clusterId}/resources/nodes/{name}/cordon
func (t *ExecutionTools) CordonNode(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a cordonNodeArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("cordon_node: invalid args: %w", err)
	}
	if a.Name == "" {
		return nil, fmt.Errorf("cordon_node: name is required")
	}

	result, err := t.safetyCheck(ctx, "cordon", "Node", "", a.Name, a.Justification,
		map[string]interface{}{"unschedulable": true})
	if err != nil {
		return nil, fmt.Errorf("cordon_node: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":  true,
			"approved": true,
			"node":     a.Name,
			"message":  fmt.Sprintf("DRY RUN: Node %s would be cordoned (marked unschedulable)", a.Name),
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/nodes/%s/cordon", clusterID, a.Name)
	resp, status, err := t.http.Post(ctx, path, map[string]interface{}{
		"unschedulable": true,
	})
	if err != nil {
		return nil, fmt.Errorf("cordon_node: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Cordoned node %s", a.Name)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved": true,
		"node":     a.Name,
		"success":  status < 300,
		"message":  responseMessage(resp, status),
	}, nil
}

// ─── drain_node (Autonomy Level 4) ────────────────────────────────────────────

type drainNodeArgs struct {
	ClusterID          string `json:"cluster_id,omitempty"`
	Name               string `json:"name"`
	GracePeriod        int    `json:"grace_period_seconds,omitempty"`
	IgnoreDaemonSets   bool   `json:"ignore_daemon_sets,omitempty"`
	DeleteEmptyDirData bool   `json:"delete_emptydir_data,omitempty"`
	Justification      string `json:"justification,omitempty"`
	DryRun             bool   `json:"dry_run,omitempty"`
}

// DrainNode evicts all pods from a node (Level 4 — requires explicit approval).
// Uses POST /api/v1/clusters/{clusterId}/resources/nodes/{name}/drain
func (t *ExecutionTools) DrainNode(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a drainNodeArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("drain_node: invalid args: %w", err)
	}
	if a.Name == "" {
		return nil, fmt.Errorf("drain_node: name is required")
	}
	if a.GracePeriod <= 0 {
		a.GracePeriod = 30
	}

	result, err := t.safetyCheck(ctx, "drain", "Node", "", a.Name, a.Justification,
		map[string]interface{}{
			"grace_period":         a.GracePeriod,
			"ignore_daemon_sets":   a.IgnoreDaemonSets,
			"delete_emptydir_data": a.DeleteEmptyDirData,
		})
	if err != nil {
		return nil, fmt.Errorf("drain_node: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":  true,
			"approved": true,
			"node":     a.Name,
			"message":  fmt.Sprintf("DRY RUN: Node %s would be drained (all pods evicted)", a.Name),
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/nodes/%s/drain", clusterID, a.Name)
	resp, status, err := t.http.Post(ctx, path, map[string]interface{}{
		"grace_period_seconds":  a.GracePeriod,
		"ignore_daemon_sets":    a.IgnoreDaemonSets,
		"delete_emptydir_data":  a.DeleteEmptyDirData,
	})
	if err != nil {
		return nil, fmt.Errorf("drain_node: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Drained node %s", a.Name)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved": true,
		"node":     a.Name,
		"success":  status < 300,
		"message":  responseMessage(resp, status),
	}, nil
}

// ─── apply_resource_patch (Autonomy Level 4) ──────────────────────────────────

type applyResourcePatchArgs struct {
	ClusterID     string                 `json:"cluster_id,omitempty"`
	Namespace     string                 `json:"namespace"`
	Kind          string                 `json:"kind"`
	Name          string                 `json:"name"`
	Patch         map[string]interface{} `json:"patch"`
	PatchType     string                 `json:"patch_type,omitempty"` // "merge" or "strategic"
	Justification string                 `json:"justification,omitempty"`
	DryRun        bool                   `json:"dry_run,omitempty"`
}

// ApplyResourcePatch applies a JSON merge patch to a resource.
// Uses PATCH /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}
func (t *ExecutionTools) ApplyResourcePatch(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a applyResourcePatchArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("apply_resource_patch: invalid args: %w", err)
	}
	if a.Kind == "" || a.Name == "" {
		return nil, fmt.Errorf("apply_resource_patch: kind and name are required")
	}
	if a.Patch == nil {
		return nil, fmt.Errorf("apply_resource_patch: patch is required")
	}
	if a.PatchType == "" {
		a.PatchType = "merge"
	}

	result, err := t.safetyCheck(ctx, "patch", a.Kind, a.Namespace, a.Name, a.Justification, a.Patch)
	if err != nil {
		return nil, fmt.Errorf("apply_resource_patch: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":  true,
			"approved": true,
			"resource": fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
			"patch":    a.Patch,
			"message":  "DRY RUN: Patch would be applied",
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/%s/%s/%s",
		clusterID, a.Kind, a.Namespace, a.Name)
	resp, status, err := t.http.Patch(ctx, path, a.Patch)
	if err != nil {
		return nil, fmt.Errorf("apply_resource_patch: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Patched %s/%s/%s", a.Kind, a.Namespace, a.Name)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved": true,
		"resource": fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
		"success":  status < 300,
		"message":  responseMessage(resp, status),
	}, nil
}

// ─── delete_resource (Autonomy Level 5) ───────────────────────────────────────

type deleteResourceArgs struct {
	ClusterID          string `json:"cluster_id,omitempty"`
	Namespace          string `json:"namespace"`
	Kind               string `json:"kind"`
	Name               string `json:"name"`
	GracePeriodSeconds int    `json:"grace_period_seconds,omitempty"`
	Justification      string `json:"justification,omitempty"`
	DryRun             bool   `json:"dry_run,omitempty"`
}

// DeleteResource deletes a resource (Level 5 — most restrictive, always requires human approval).
// Uses DELETE /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}
func (t *ExecutionTools) DeleteResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a deleteResourceArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("delete_resource: invalid args: %w", err)
	}
	if a.Kind == "" || a.Name == "" {
		return nil, fmt.Errorf("delete_resource: kind and name are required")
	}

	result, err := t.safetyCheck(ctx, "delete", a.Kind, a.Namespace, a.Name, a.Justification, nil)
	if err != nil {
		return nil, fmt.Errorf("delete_resource: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":  true,
			"approved": true,
			"resource": fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
			"message":  "DRY RUN: Resource would be deleted",
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/%s/%s/%s",
		clusterID, a.Kind, a.Namespace, a.Name)
	resp, status, err := t.http.Delete(ctx, path, map[string]string{
		"X-Confirm-Destructive": "true",
	})
	if err != nil {
		return nil, fmt.Errorf("delete_resource: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Deleted %s/%s/%s", a.Kind, a.Namespace, a.Name)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved": true,
		"resource": fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
		"success":  status < 300,
		"message":  responseMessage(resp, status),
	}, nil
}

// ─── rollback_deployment (Autonomy Level 3) ───────────────────────────────────

type rollbackDeploymentArgs struct {
	ClusterID     string `json:"cluster_id,omitempty"`
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	Revision      int    `json:"revision,omitempty"` // 0 = previous
	Justification string `json:"justification,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

// RollbackDeployment rolls back a deployment to a previous revision.
// Uses POST /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback
func (t *ExecutionTools) RollbackDeployment(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a rollbackDeploymentArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("rollback_deployment: invalid args: %w", err)
	}
	if a.Namespace == "" || a.Name == "" {
		return nil, fmt.Errorf("rollback_deployment: namespace and name are required")
	}

	result, err := t.safetyCheck(ctx, "rollback", "Deployment", a.Namespace, a.Name, a.Justification,
		map[string]interface{}{"revision": a.Revision})
	if err != nil {
		return nil, fmt.Errorf("rollback_deployment: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":   true,
			"approved":  true,
			"name":      a.Name,
			"namespace": a.Namespace,
			"revision":  a.Revision,
			"message":   fmt.Sprintf("DRY RUN: Deployment %s would be rolled back to revision %d", a.Name, a.Revision),
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/deployments/%s/%s/rollback",
		clusterID, a.Namespace, a.Name)
	resp, status, err := t.http.Post(ctx, path, map[string]interface{}{
		"revision": a.Revision,
	})
	if err != nil {
		return nil, fmt.Errorf("rollback_deployment: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Rolled back deployment %s/%s to revision %d", a.Namespace, a.Name, a.Revision)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved":  true,
		"name":      a.Name,
		"namespace": a.Namespace,
		"revision":  a.Revision,
		"success":   status < 300,
		"message":   responseMessage(resp, status),
	}, nil
}

// ─── update_resource_limits (Autonomy Level 3) ────────────────────────────────

type updateResourceLimitsArgs struct {
	ClusterID     string `json:"cluster_id,omitempty"`
	Namespace     string `json:"namespace"`
	Kind          string `json:"kind"`
	Name          string `json:"name"`
	ContainerName string `json:"container_name"`
	CPURequest    string `json:"cpu_request,omitempty"`
	CPULimit      string `json:"cpu_limit,omitempty"`
	MemoryRequest string `json:"memory_request,omitempty"`
	MemoryLimit   string `json:"memory_limit,omitempty"`
	Justification string `json:"justification,omitempty"`
	DryRun        bool   `json:"dry_run,omitempty"`
}

// UpdateResourceLimits patches resource requests/limits on a container.
// Uses PATCH /api/v1/clusters/{clusterId}/resources/{kind}/{namespace}/{name}
func (t *ExecutionTools) UpdateResourceLimits(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a updateResourceLimitsArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("update_resource_limits: invalid args: %w", err)
	}
	if a.Kind == "" || a.Name == "" || a.ContainerName == "" {
		return nil, fmt.Errorf("update_resource_limits: kind, name, and container_name are required")
	}

	patch := buildResourceLimitsPatch(a)
	result, err := t.safetyCheck(ctx, "update_limits", a.Kind, a.Namespace, a.Name, a.Justification, patch)
	if err != nil {
		return nil, fmt.Errorf("update_resource_limits: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":   true,
			"approved":  true,
			"resource":  fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
			"container": a.ContainerName,
			"patch":     patch,
			"message":   "DRY RUN: Resource limits would be updated",
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/%s/%s/%s",
		clusterID, a.Kind, a.Namespace, a.Name)
	resp, status, err := t.http.Patch(ctx, path, patch)
	if err != nil {
		return nil, fmt.Errorf("update_resource_limits: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Updated resource limits for %s/%s/%s container %s",
			a.Kind, a.Namespace, a.Name, a.ContainerName)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved":  true,
		"resource":  fmt.Sprintf("%s/%s/%s", a.Kind, a.Namespace, a.Name),
		"container": a.ContainerName,
		"success":   status < 300,
		"message":   responseMessage(resp, status),
	}, nil
}

func buildResourceLimitsPatch(a updateResourceLimitsArgs) map[string]interface{} {
	resources := map[string]interface{}{}
	if a.CPURequest != "" || a.MemoryRequest != "" {
		requests := map[string]interface{}{}
		if a.CPURequest != "" {
			requests["cpu"] = a.CPURequest
		}
		if a.MemoryRequest != "" {
			requests["memory"] = a.MemoryRequest
		}
		resources["requests"] = requests
	}
	if a.CPULimit != "" || a.MemoryLimit != "" {
		limits := map[string]interface{}{}
		if a.CPULimit != "" {
			limits["cpu"] = a.CPULimit
		}
		if a.MemoryLimit != "" {
			limits["memory"] = a.MemoryLimit
		}
		resources["limits"] = limits
	}

	return map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{
							"name":      a.ContainerName,
							"resources": resources,
						},
					},
				},
			},
		},
	}
}

// ─── trigger_hpa_scale (Autonomy Level 4) ─────────────────────────────────────

type triggerHPAScaleArgs struct {
	ClusterID      string `json:"cluster_id,omitempty"`
	Namespace      string `json:"namespace"`
	Name           string `json:"name"`
	TargetReplicas int    `json:"target_replicas"`
	Justification  string `json:"justification,omitempty"`
	DryRun         bool   `json:"dry_run,omitempty"`
}

// TriggerHPAScale manually overrides HPA min/max replica counts.
// Uses PATCH /api/v1/clusters/{clusterId}/resources/HorizontalPodAutoscaler/{namespace}/{name}
func (t *ExecutionTools) TriggerHPAScale(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	var a triggerHPAScaleArgs
	if err := decodeArgs(args, &a); err != nil {
		return nil, fmt.Errorf("trigger_hpa_scale: invalid args: %w", err)
	}
	if a.Namespace == "" || a.Name == "" {
		return nil, fmt.Errorf("trigger_hpa_scale: namespace and name are required")
	}
	if a.TargetReplicas <= 0 {
		return nil, fmt.Errorf("trigger_hpa_scale: target_replicas must be > 0")
	}

	result, err := t.safetyCheck(ctx, "hpa_scale", "HorizontalPodAutoscaler", a.Namespace, a.Name,
		a.Justification, map[string]interface{}{"target_replicas": a.TargetReplicas})
	if err != nil {
		return nil, fmt.Errorf("trigger_hpa_scale: safety evaluation failed: %w", err)
	}
	if !result.Approved {
		return safetyDenied(result)
	}

	if a.DryRun {
		return map[string]interface{}{
			"dry_run":         true,
			"approved":        true,
			"hpa":             a.Name,
			"namespace":       a.Namespace,
			"target_replicas": a.TargetReplicas,
			"message":         fmt.Sprintf("DRY RUN: HPA %s would be scaled to %d replicas", a.Name, a.TargetReplicas),
		}, nil
	}

	clusterID := strExecArg(args, "cluster_id")
	path := fmt.Sprintf("/api/v1/clusters/%s/resources/HorizontalPodAutoscaler/%s/%s",
		clusterID, a.Namespace, a.Name)
	resp, status, err := t.http.Patch(ctx, path, map[string]interface{}{
		"spec": map[string]interface{}{
			"minReplicas": a.TargetReplicas,
			"maxReplicas": a.TargetReplicas,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("trigger_hpa_scale: %w", err)
	}

	t.auditLog.Log(ctx, audit.NewEvent(audit.EventActionExecuted).
		WithDescription(fmt.Sprintf("Triggered HPA scale for %s/%s to %d replicas",
			a.Namespace, a.Name, a.TargetReplicas)).
		WithResult(audit.ResultSuccess))

	return map[string]interface{}{
		"approved":        true,
		"hpa":             a.Name,
		"namespace":       a.Namespace,
		"target_replicas": a.TargetReplicas,
		"success":         status < 300,
		"message":         responseMessage(resp, status),
	}, nil
}

// ─── defaultHTTPExecutor ──────────────────────────────────────────────────────

// defaultHTTPExecutor implements HTTPExecutor using Go's net/http.
type defaultHTTPExecutor struct {
	baseURL    string
	httpClient *http.Client
}

func newDefaultHTTPExecutor(baseURL string) *defaultHTTPExecutor {
	if baseURL == "" {
		baseURL = "http://localhost:8190"
	}
	return &defaultHTTPExecutor{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

func (e *defaultHTTPExecutor) Post(ctx context.Context, path string, body interface{}) (map[string]interface{}, int, error) {
	return e.doJSON(ctx, http.MethodPost, path, body, nil)
}

func (e *defaultHTTPExecutor) Patch(ctx context.Context, path string, body interface{}) (map[string]interface{}, int, error) {
	return e.doJSON(ctx, http.MethodPatch, path, body, nil)
}

func (e *defaultHTTPExecutor) Delete(ctx context.Context, path string, headers map[string]string) (map[string]interface{}, int, error) {
	return e.doJSON(ctx, http.MethodDelete, path, nil, headers)
}

func (e *defaultHTTPExecutor) doJSON(ctx context.Context, method, path string, body interface{}, extraHeaders map[string]string) (map[string]interface{}, int, error) {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, e.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if len(respBody) > 0 {
		_ = json.Unmarshal(respBody, &result)
	}
	if result == nil {
		result = map[string]interface{}{}
	}

	if resp.StatusCode >= 400 {
		return result, resp.StatusCode, fmt.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, truncateExec(string(respBody), 200))
	}
	return result, resp.StatusCode, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func decodeArgs(args map[string]interface{}, target interface{}) error {
	b, err := json.Marshal(args)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, target)
}

// strExecArg extracts a string value from args by key.
func strExecArg(args map[string]interface{}, key string) string {
	v, _ := args[key].(string)
	return v
}

// responseMessage extracts a human-readable message from an HTTP response map.
func responseMessage(resp map[string]interface{}, status int) string {
	if msg, ok := resp["message"].(string); ok && msg != "" {
		return msg
	}
	if status < 300 {
		return "ok"
	}
	return fmt.Sprintf("HTTP %d", status)
}

func truncateExec(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
