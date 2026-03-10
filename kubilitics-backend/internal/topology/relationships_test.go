package topology

import (
	"context"
	"fmt"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
)

// --- Namespace Containment (Rule 0) ---

func TestInferNamespaceContainment(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{ID: "Namespace/default", Kind: "Namespace", Name: "default", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Pod/default/nginx", Kind: "Pod", Namespace: "default", Name: "nginx", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Service/default/web", Kind: "Service", Namespace: "default", Name: "web", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Node/worker-1", Kind: "Node", Name: "worker-1", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNamespaceContainment()
	require.NoError(t, err)

	// Pod and Service should have containment edges; Node (cluster-scoped) should not
	assert.True(t, graph.EdgeMap["Namespace/default->Pod/default/nginx:contains"])
	assert.True(t, graph.EdgeMap["Namespace/default->Service/default/web:contains"])
	assert.False(t, graph.EdgeMap["Namespace/default->Node/worker-1:contains"], "cluster-scoped Node should not get contains edge")
}

func TestInferNamespaceContainment_MultipleNamespaces(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{ID: "Namespace/default", Kind: "Namespace", Name: "default", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Namespace/prod", Kind: "Namespace", Name: "prod", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Pod/default/a", Kind: "Pod", Namespace: "default", Name: "a", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Pod/prod/b", Kind: "Pod", Namespace: "prod", Name: "b", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNamespaceContainment()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Namespace/default->Pod/default/a:contains"])
	assert.True(t, graph.EdgeMap["Namespace/prod->Pod/prod/b:contains"])
	assert.False(t, graph.EdgeMap["Namespace/default->Pod/prod/b:contains"], "cross-namespace containment must not exist")
}

// --- Owner References (Rule 1) ---

func TestInferOwnerReferences_DeployRSPodChain(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{ID: "Deployment/default/app", Kind: "Deployment", Namespace: "default", Name: "app", Metadata: models.NodeMetadata{UID: "deploy-uid"}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "ReplicaSet/default/app-abc", Kind: "ReplicaSet", Namespace: "default", Name: "app-abc", Metadata: models.NodeMetadata{UID: "rs-uid"}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Pod/default/app-abc-1", Kind: "Pod", Namespace: "default", Name: "app-abc-1", Metadata: models.NodeMetadata{UID: "pod-uid"}, Computed: models.NodeComputed{}})

	graph.SetOwnerRefs("ReplicaSet/default/app-abc", []OwnerRef{{UID: "deploy-uid", Kind: "Deployment", Name: "app"}})
	graph.SetOwnerRefs("Pod/default/app-abc-1", []OwnerRef{{UID: "rs-uid", Kind: "ReplicaSet", Name: "app-abc"}})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferOwnerReferences()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Deployment/default/app->ReplicaSet/default/app-abc:owns"])
	assert.True(t, graph.EdgeMap["ReplicaSet/default/app-abc->Pod/default/app-abc-1:owns"])
	assert.Len(t, graph.Edges, 2)
}

func TestInferOwnerReferences_OrphanRef(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{ID: "Pod/default/orphan", Kind: "Pod", Namespace: "default", Name: "orphan", Metadata: models.NodeMetadata{UID: "pod-uid"}, Computed: models.NodeComputed{}})
	// Owner UID doesn't match any node in graph
	graph.SetOwnerRefs("Pod/default/orphan", []OwnerRef{{UID: "nonexistent-uid", Kind: "ReplicaSet", Name: "gone"}})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferOwnerReferences()
	require.NoError(t, err)

	assert.Len(t, graph.Edges, 0, "orphan owner reference should produce no edge")
}

// --- Label Selectors (Rule 2) ---

func TestInferLabelSelectors_ServiceToPods(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/web", Kind: "Service", Namespace: "default", Name: "web",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/web-1", Kind: "Pod", Namespace: "default", Name: "web-1",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "web", "tier": "frontend"}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/web-2", Kind: "Pod", Namespace: "default", Name: "web-2",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "web", "tier": "frontend"}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/api-1", Kind: "Pod", Namespace: "default", Name: "api-1",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "api"}}, Computed: models.NodeComputed{},
	})

	// Service selector: app=web (stored in nodeExtra, not metadata.labels)
	graph.SetNodeExtra("Service/default/web", map[string]interface{}{
		"selector": map[string]interface{}{"app": "web"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Service/default/web->Pod/default/web-1:selects"])
	assert.True(t, graph.EdgeMap["Service/default/web->Pod/default/web-2:selects"])
	assert.False(t, graph.EdgeMap["Service/default/web->Pod/default/api-1:selects"], "api pod should not match web selector")
}

func TestInferLabelSelectors_ServiceNoMatchingPods(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/orphan-svc", Kind: "Service", Namespace: "default", Name: "orphan-svc",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/unrelated", Kind: "Pod", Namespace: "default", Name: "unrelated",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "other"}}, Computed: models.NodeComputed{},
	})
	graph.SetNodeExtra("Service/default/orphan-svc", map[string]interface{}{
		"selector": map[string]interface{}{"app": "nonexistent"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.Len(t, graph.Edges, 0, "no pods match selector, so no edges expected")
}

func TestInferLabelSelectors_MultiLabelSelector(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/svc", Kind: "Service", Namespace: "default", Name: "svc",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/match", Kind: "Pod", Namespace: "default", Name: "match",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "web", "env": "prod"}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/partial", Kind: "Pod", Namespace: "default", Name: "partial",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "web", "env": "staging"}}, Computed: models.NodeComputed{},
	})
	// Selector requires BOTH app=web AND env=prod
	graph.SetNodeExtra("Service/default/svc", map[string]interface{}{
		"selector": map[string]interface{}{"app": "web", "env": "prod"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Service/default/svc->Pod/default/match:selects"])
	assert.False(t, graph.EdgeMap["Service/default/svc->Pod/default/partial:selects"], "partial label match should not select")
}

func TestInferLabelSelectors_NetworkPolicyToPods(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "NetworkPolicy/default/deny-all", Kind: "NetworkPolicy", Namespace: "default", Name: "deny-all",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/target", Kind: "Pod", Namespace: "default", Name: "target",
		Metadata: models.NodeMetadata{Labels: map[string]string{"role": "db"}}, Computed: models.NodeComputed{},
	})
	graph.SetNodeExtra("NetworkPolicy/default/deny-all", map[string]interface{}{
		"podSelector": map[string]interface{}{"role": "db"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["NetworkPolicy/default/deny-all->Pod/default/target:selects"])
}

func TestInferLabelSelectors_PDBToPods(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "PodDisruptionBudget/default/pdb", Kind: "PodDisruptionBudget", Namespace: "default", Name: "pdb",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/web-1", Kind: "Pod", Namespace: "default", Name: "web-1",
		Metadata: models.NodeMetadata{Labels: map[string]string{"app": "web"}}, Computed: models.NodeComputed{},
	})
	graph.SetNodeExtra("PodDisruptionBudget/default/pdb", map[string]interface{}{
		"podSelector": map[string]interface{}{"app": "web"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["PodDisruptionBudget/default/pdb->Pod/default/web-1:selects"])
}

func TestInferLabelSelectors_HPAToDeployment(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "HorizontalPodAutoscaler/default/hpa", Kind: "HorizontalPodAutoscaler", Namespace: "default", Name: "hpa",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Deployment/default/app", Kind: "Deployment", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.SetNodeExtra("HorizontalPodAutoscaler/default/hpa", map[string]interface{}{
		"scaleTargetRef": map[string]interface{}{"kind": "Deployment", "name": "app"},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferLabelSelectors()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["HorizontalPodAutoscaler/default/hpa->Deployment/default/app:manages"])
}

// --- Volume Relationships (Rule 3) ---

func TestInferVolumeRelationships(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app", Kind: "Pod", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ConfigMap/default/config", Kind: "ConfigMap", Namespace: "default", Name: "config",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Secret/default/creds", Kind: "Secret", Namespace: "default", Name: "creds",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "PersistentVolumeClaim/default/data", Kind: "PersistentVolumeClaim", Namespace: "default", Name: "data",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	// Cache pod spec with all three volume types
	graph.PodSpecCache["default/app"] = corev1.PodSpec{
		Volumes: []corev1.Volume{
			{Name: "cfg", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "config"}}}},
			{Name: "sec", VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "creds"}}},
			{Name: "pvc", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "data"}}},
		},
	}

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferVolumeRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/app->ConfigMap/default/config:configures"])
	assert.True(t, graph.EdgeMap["Pod/default/app->Secret/default/creds:configures"])
	assert.True(t, graph.EdgeMap["Pod/default/app->PersistentVolumeClaim/default/data:mounts"])
	assert.Len(t, graph.Edges, 3)
}

// --- Environment Variable Relationships (Rule 4) ---

func TestInferEnvironmentRelationships(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app", Kind: "Pod", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ConfigMap/default/env-config", Kind: "ConfigMap", Namespace: "default", Name: "env-config",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Secret/default/db-pass", Kind: "Secret", Namespace: "default", Name: "db-pass",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.PodSpecCache["default/app"] = corev1.PodSpec{
		Containers: []corev1.Container{
			{
				Name: "main",
				EnvFrom: []corev1.EnvFromSource{
					{ConfigMapRef: &corev1.ConfigMapEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "env-config"}}},
				},
				Env: []corev1.EnvVar{
					{Name: "DB_PASS", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "db-pass"}, Key: "password"}}},
				},
			},
		},
	}

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferEnvironmentRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/app->ConfigMap/default/env-config:configures"])
	assert.True(t, graph.EdgeMap["Pod/default/app->Secret/default/db-pass:configures"])
	assert.Len(t, graph.Edges, 2)
}

func TestInferEnvironmentRelationships_ConfigMapKeyRef(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/p", Kind: "Pod", Namespace: "default", Name: "p",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ConfigMap/default/cm", Kind: "ConfigMap", Namespace: "default", Name: "cm",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.PodSpecCache["default/p"] = corev1.PodSpec{
		Containers: []corev1.Container{
			{
				Name: "c",
				Env: []corev1.EnvVar{
					{Name: "KEY", ValueFrom: &corev1.EnvVarSource{ConfigMapKeyRef: &corev1.ConfigMapKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "cm"}, Key: "k"}}},
				},
			},
		},
	}

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferEnvironmentRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/p->ConfigMap/default/cm:configures"])
}

// --- RBAC Relationships (Rule 5) ---

func TestInferRBACRelationships_PodToSA(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app", Kind: "Pod", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ServiceAccount/default/app-sa", Kind: "ServiceAccount", Namespace: "default", Name: "app-sa",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.SetNodeExtra("Pod/default/app", map[string]interface{}{"serviceAccountName": "app-sa"})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferRBACRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/app->ServiceAccount/default/app-sa:uses"])
}

func TestInferRBACRelationships_FullChain(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app", Kind: "Pod", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ServiceAccount/default/app-sa", Kind: "ServiceAccount", Namespace: "default", Name: "app-sa",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "RoleBinding/default/app-rb", Kind: "RoleBinding", Namespace: "default", Name: "app-rb",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Role/default/app-role", Kind: "Role", Namespace: "default", Name: "app-role",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("Pod/default/app", map[string]interface{}{"serviceAccountName": "app-sa"})
	graph.SetNodeExtra("RoleBinding/default/app-rb", map[string]interface{}{
		"roleRef": map[string]interface{}{"kind": "Role", "name": "app-role"},
		"subjects": []interface{}{
			map[string]interface{}{"kind": "ServiceAccount", "name": "app-sa", "namespace": "default"},
		},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferRBACRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/app->ServiceAccount/default/app-sa:uses"])
	assert.True(t, graph.EdgeMap["RoleBinding/default/app-rb->Role/default/app-role:permits"])
	assert.True(t, graph.EdgeMap["RoleBinding/default/app-rb->ServiceAccount/default/app-sa:permits"])
}

func TestInferRBACRelationships_ClusterRoleBinding(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "ClusterRoleBinding/admin-binding", Kind: "ClusterRoleBinding", Name: "admin-binding",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ClusterRole/admin", Kind: "ClusterRole", Name: "admin",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "ServiceAccount/kube-system/admin-sa", Kind: "ServiceAccount", Namespace: "kube-system", Name: "admin-sa",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("ClusterRoleBinding/admin-binding", map[string]interface{}{
		"roleRef": map[string]interface{}{"kind": "ClusterRole", "name": "admin"},
		"subjects": []interface{}{
			map[string]interface{}{"kind": "ServiceAccount", "name": "admin-sa", "namespace": "kube-system"},
		},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferRBACRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["ClusterRoleBinding/admin-binding->ClusterRole/admin:permits"])
	assert.True(t, graph.EdgeMap["ClusterRoleBinding/admin-binding->ServiceAccount/kube-system/admin-sa:permits"])
}

// --- Network Relationships (Rule 6) ---

func TestInferNetworkRelationships_IngressToService(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Ingress/default/web-ing", Kind: "Ingress", Namespace: "default", Name: "web-ing",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/web-svc", Kind: "Service", Namespace: "default", Name: "web-svc",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("Ingress/default/web-ing", map[string]interface{}{
		"spec": map[string]interface{}{
			"rules": []interface{}{
				map[string]interface{}{
					"http": map[string]interface{}{
						"paths": []interface{}{
							map[string]interface{}{
								"backend": map[string]interface{}{
									"service": map[string]interface{}{"name": "web-svc"},
								},
							},
						},
					},
				},
			},
		},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNetworkRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Ingress/default/web-ing->Service/default/web-svc:routes"])
}

func TestInferNetworkRelationships_IngressDefaultBackend(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Ingress/default/catch-all", Kind: "Ingress", Namespace: "default", Name: "catch-all",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/fallback", Kind: "Service", Namespace: "default", Name: "fallback",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("Ingress/default/catch-all", map[string]interface{}{
		"spec": map[string]interface{}{
			"rules": []interface{}{},
			"defaultBackend": map[string]interface{}{
				"service": map[string]interface{}{"name": "fallback"},
			},
		},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNetworkRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Ingress/default/catch-all->Service/default/fallback:routes"])
}

func TestInferNetworkRelationships_ServiceToEndpoints(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/api", Kind: "Service", Namespace: "default", Name: "api",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Endpoints/default/api", Kind: "Endpoints", Namespace: "default", Name: "api",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNetworkRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Service/default/api->Endpoints/default/api:exposes"])
}

func TestInferNetworkRelationships_IngressMultipleRules(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Ingress/default/multi", Kind: "Ingress", Namespace: "default", Name: "multi",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/svc-a", Kind: "Service", Namespace: "default", Name: "svc-a",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Service/default/svc-b", Kind: "Service", Namespace: "default", Name: "svc-b",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("Ingress/default/multi", map[string]interface{}{
		"spec": map[string]interface{}{
			"rules": []interface{}{
				map[string]interface{}{
					"http": map[string]interface{}{
						"paths": []interface{}{
							map[string]interface{}{"backend": map[string]interface{}{"service": map[string]interface{}{"name": "svc-a"}}},
						},
					},
				},
				map[string]interface{}{
					"http": map[string]interface{}{
						"paths": []interface{}{
							map[string]interface{}{"backend": map[string]interface{}{"service": map[string]interface{}{"name": "svc-b"}}},
						},
					},
				},
			},
		},
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNetworkRelationships()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Ingress/default/multi->Service/default/svc-a:routes"])
	assert.True(t, graph.EdgeMap["Ingress/default/multi->Service/default/svc-b:routes"])
}

// --- Storage Relationships (Rule 7) ---

func TestInferStorageRelationships_FullChain(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "PersistentVolumeClaim/default/data", Kind: "PersistentVolumeClaim", Namespace: "default", Name: "data",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "PersistentVolume/pv-001", Kind: "PersistentVolume", Name: "pv-001",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "StorageClass/gp3", Kind: "StorageClass", Name: "gp3",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("PersistentVolumeClaim/default/data", map[string]interface{}{
		"volumeName":       "pv-001",
		"storageClassName": "gp3",
	})
	graph.SetNodeExtra("PersistentVolume/pv-001", map[string]interface{}{
		"storageClassName": "gp3",
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferStorageRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["PersistentVolumeClaim/default/data->PersistentVolume/pv-001:stores"])
	assert.True(t, graph.EdgeMap["PersistentVolumeClaim/default/data->StorageClass/gp3:stores"])
	assert.True(t, graph.EdgeMap["PersistentVolume/pv-001->StorageClass/gp3:stores"])
	assert.Len(t, graph.Edges, 3)
}

func TestInferStorageRelationships_PVCWithoutPV(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "PersistentVolumeClaim/default/pending", Kind: "PersistentVolumeClaim", Namespace: "default", Name: "pending",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "StorageClass/gp3", Kind: "StorageClass", Name: "gp3",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	// PVC has storageClassName but no volumeName (pending state)
	graph.SetNodeExtra("PersistentVolumeClaim/default/pending", map[string]interface{}{
		"storageClassName": "gp3",
	})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferStorageRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["PersistentVolumeClaim/default/pending->StorageClass/gp3:stores"])
	assert.Len(t, graph.Edges, 1, "only PVC->SC edge, no PVC->PV edge")
}

// --- Node Relationships (Rule 8) ---

func TestInferNodeRelationships(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app-1", Kind: "Pod", Namespace: "default", Name: "app-1",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/app-2", Kind: "Pod", Namespace: "default", Name: "app-2",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Node/worker-1", Kind: "Node", Name: "worker-1",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Node/worker-2", Kind: "Node", Name: "worker-2",
		Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})

	graph.SetNodeExtra("Pod/default/app-1", map[string]interface{}{"nodeName": "worker-1"})
	graph.SetNodeExtra("Pod/default/app-2", map[string]interface{}{"nodeName": "worker-2"})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNodeRelationships(context.Background())
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Pod/default/app-1->Node/worker-1:schedules"])
	assert.True(t, graph.EdgeMap["Pod/default/app-2->Node/worker-2:schedules"])
	assert.Len(t, graph.Edges, 2)
}

func TestInferNodeRelationships_PendingPod(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/pending", Kind: "Pod", Namespace: "default", Name: "pending",
		Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{},
	})
	// Pending pod has no nodeName
	graph.SetNodeExtra("Pod/default/pending", map[string]interface{}{"serviceAccountName": "default"})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferNodeRelationships(context.Background())
	require.NoError(t, err)

	assert.Len(t, graph.Edges, 0, "pending pod with no nodeName should produce no scheduling edge")
}

// --- CRD Owner References ---

func TestInferOwnerReferences_CRDWithOwnerRef(t *testing.T) {
	graph := NewGraph(0)
	graph.AddNode(models.TopologyNode{
		ID: "Deployment/default/app", Kind: "Deployment", Namespace: "default", Name: "app",
		Metadata: models.NodeMetadata{UID: "deploy-uid"}, Computed: models.NodeComputed{},
	})
	graph.AddNode(models.TopologyNode{
		ID: "Certificate/default/app-tls", Kind: "Certificate", Namespace: "default", Name: "app-tls",
		Metadata: models.NodeMetadata{UID: "cert-uid"}, Computed: models.NodeComputed{},
	})
	// CRD cert-manager Certificate owned by a Deployment (uncommon but valid)
	graph.SetOwnerRefs("Certificate/default/app-tls", []OwnerRef{{UID: "deploy-uid", Kind: "Deployment", Name: "app"}})

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.inferOwnerReferences()
	require.NoError(t, err)

	assert.True(t, graph.EdgeMap["Deployment/default/app->Certificate/default/app-tls:owns"])
}

// --- Full InferAllRelationships integration ---

func TestInferAllRelationships_Integration(t *testing.T) {
	graph := NewGraph(0)

	// Namespace
	graph.AddNode(models.TopologyNode{ID: "Namespace/default", Kind: "Namespace", Name: "default", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	// Deployment -> RS -> Pod chain
	graph.AddNode(models.TopologyNode{ID: "Deployment/default/web", Kind: "Deployment", Namespace: "default", Name: "web", Metadata: models.NodeMetadata{UID: "d-uid"}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "ReplicaSet/default/web-abc", Kind: "ReplicaSet", Namespace: "default", Name: "web-abc", Metadata: models.NodeMetadata{UID: "rs-uid"}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "Pod/default/web-abc-1", Kind: "Pod", Namespace: "default", Name: "web-abc-1", Metadata: models.NodeMetadata{UID: "p-uid", Labels: map[string]string{"app": "web"}}, Computed: models.NodeComputed{}})

	// Service
	graph.AddNode(models.TopologyNode{ID: "Service/default/web-svc", Kind: "Service", Namespace: "default", Name: "web-svc", Metadata: models.NodeMetadata{Labels: map[string]string{}}, Computed: models.NodeComputed{}})

	// Node
	graph.AddNode(models.TopologyNode{ID: "Node/worker-1", Kind: "Node", Name: "worker-1", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	// ConfigMap
	graph.AddNode(models.TopologyNode{ID: "ConfigMap/default/cfg", Kind: "ConfigMap", Namespace: "default", Name: "cfg", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	// ServiceAccount
	graph.AddNode(models.TopologyNode{ID: "ServiceAccount/default/web-sa", Kind: "ServiceAccount", Namespace: "default", Name: "web-sa", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	// Owner references
	graph.SetOwnerRefs("ReplicaSet/default/web-abc", []OwnerRef{{UID: "d-uid", Kind: "Deployment", Name: "web"}})
	graph.SetOwnerRefs("Pod/default/web-abc-1", []OwnerRef{{UID: "rs-uid", Kind: "ReplicaSet", Name: "web-abc"}})

	// Service selector
	graph.SetNodeExtra("Service/default/web-svc", map[string]interface{}{
		"selector": map[string]interface{}{"app": "web"},
	})

	// Pod extras
	graph.SetNodeExtra("Pod/default/web-abc-1", map[string]interface{}{
		"serviceAccountName": "web-sa",
		"nodeName":           "worker-1",
	})

	// Pod spec cache (for volume inference)
	graph.PodSpecCache["default/web-abc-1"] = corev1.PodSpec{
		Volumes: []corev1.Volume{
			{Name: "config-vol", VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "cfg"}}}},
		},
		Containers: []corev1.Container{{Name: "main"}},
	}

	ri := NewRelationshipInferencer(nil, graph)
	err := ri.InferAllRelationships(context.Background())
	require.NoError(t, err)

	// Verify all expected relationships exist
	assert.True(t, graph.EdgeMap["Namespace/default->Deployment/default/web:contains"], "namespace containment")
	assert.True(t, graph.EdgeMap["Namespace/default->Pod/default/web-abc-1:contains"], "namespace containment")
	assert.True(t, graph.EdgeMap["Deployment/default/web->ReplicaSet/default/web-abc:owns"], "ownership")
	assert.True(t, graph.EdgeMap["ReplicaSet/default/web-abc->Pod/default/web-abc-1:owns"], "ownership")
	assert.True(t, graph.EdgeMap["Service/default/web-svc->Pod/default/web-abc-1:selects"], "selector")
	assert.True(t, graph.EdgeMap["Pod/default/web-abc-1->Node/worker-1:schedules"], "scheduling")
	assert.True(t, graph.EdgeMap["Pod/default/web-abc-1->ConfigMap/default/cfg:configures"], "volume mount")
	assert.True(t, graph.EdgeMap["Pod/default/web-abc-1->ServiceAccount/default/web-sa:uses"], "RBAC")
}

// --- Per-Kind Truncation (T1.1) ---

func TestPerKindTruncation(t *testing.T) {
	graph := NewGraph(10)

	// Add 8 pods (should all fit)
	for i := 0; i < 8; i++ {
		graph.AddNode(models.TopologyNode{
			ID: fmt.Sprintf("Pod/default/pod-%d", i), Kind: "Pod", Namespace: "default",
			Name: fmt.Sprintf("pod-%d", i), Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
		})
	}
	assert.Len(t, graph.Nodes, 8)
	assert.False(t, graph.Truncated)

	// Add 2 services (fill to 10)
	for i := 0; i < 2; i++ {
		graph.AddNode(models.TopologyNode{
			ID: fmt.Sprintf("Service/default/svc-%d", i), Kind: "Service", Namespace: "default",
			Name: fmt.Sprintf("svc-%d", i), Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
		})
	}
	assert.Len(t, graph.Nodes, 10)
	assert.False(t, graph.Truncated)

	// Now try to add more pods — should be truncated
	graph.AddNode(models.TopologyNode{
		ID: "Pod/default/pod-overflow", Kind: "Pod", Namespace: "default",
		Name: "pod-overflow", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	assert.True(t, graph.Truncated)
	assert.True(t, graph.KindTruncated["Pod"])
	assert.False(t, graph.KindTruncated["Service"], "Service was fully added before truncation")

	// Try adding a Deployment — also truncated
	graph.AddNode(models.TopologyNode{
		ID: "Deployment/default/dep", Kind: "Deployment", Namespace: "default",
		Name: "dep", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{},
	})
	assert.True(t, graph.KindTruncated["Deployment"])

	// Verify warning message
	topo := graph.ToTopologyGraph("test")
	require.Len(t, topo.Metadata.Warnings, 1)
	assert.Equal(t, "TOPOLOGY_TRUNCATED", topo.Metadata.Warnings[0].Code)
	assert.Contains(t, topo.Metadata.Warnings[0].Message, "Deployment")
	assert.Contains(t, topo.Metadata.Warnings[0].Message, "Pod")
}

// --- Edge Adjacency Index (T1.4) ---

func TestEdgeAdjacencyIndex(t *testing.T) {
	graph := NewGraph(0)

	graph.AddEdge(models.TopologyEdge{ID: "e1", Source: "A", Target: "B", RelationshipType: "owns", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e2", Source: "A", Target: "C", RelationshipType: "selects", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e3", Source: "B", Target: "C", RelationshipType: "owns", Metadata: models.EdgeMetadata{}})

	// Test outgoing
	outA := graph.GetOutgoingEdges("A")
	assert.Len(t, outA, 2)
	outB := graph.GetOutgoingEdges("B")
	assert.Len(t, outB, 1)
	outC := graph.GetOutgoingEdges("C")
	assert.Len(t, outC, 0)

	// Test incoming
	inA := graph.GetIncomingEdges("A")
	assert.Len(t, inA, 0)
	inB := graph.GetIncomingEdges("B")
	assert.Len(t, inB, 1)
	inC := graph.GetIncomingEdges("C")
	assert.Len(t, inC, 2)
}

func TestEdgeAdjacencyIndex_AfterValidate(t *testing.T) {
	graph := NewGraph(0)

	graph.AddNode(models.TopologyNode{ID: "A", Kind: "Pod", Name: "a", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})
	graph.AddNode(models.TopologyNode{ID: "B", Kind: "Pod", Name: "b", Metadata: models.NodeMetadata{}, Computed: models.NodeComputed{}})

	// Add one valid edge and one orphan edge
	graph.AddEdge(models.TopologyEdge{ID: "e1", Source: "A", Target: "B", RelationshipType: "owns", Metadata: models.EdgeMetadata{}})
	graph.AddEdge(models.TopologyEdge{ID: "e2", Source: "A", Target: "GONE", RelationshipType: "owns", Metadata: models.EdgeMetadata{}})

	// Before validate, OutEdges has both
	assert.Len(t, graph.GetOutgoingEdges("A"), 2)

	// After validate, orphan edge is removed and indices are rebuilt
	err := graph.Validate()
	require.NoError(t, err)
	assert.Len(t, graph.GetOutgoingEdges("A"), 1, "only valid edge should remain after validate")
	assert.Len(t, graph.GetIncomingEdges("B"), 1)
	assert.Len(t, graph.GetIncomingEdges("GONE"), 0)
}
