package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// helpers to create fresh graph state for each test
func newGraphState() (
	map[string]models.ResourceRef,
	map[string]map[string]bool,
	map[string]map[string]bool,
	*[]models.BlastDependencyEdge,
) {
	nodes := make(map[string]models.ResourceRef)
	forward := make(map[string]map[string]bool)
	reverse := make(map[string]map[string]bool)
	edges := &[]models.BlastDependencyEdge{}
	return nodes, forward, reverse, edges
}

func TestAddEdge_Dedup(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	src := models.ResourceRef{Kind: "Service", Namespace: "default", Name: "web"}
	tgt := models.ResourceRef{Kind: "Deployment", Namespace: "default", Name: "api"}

	addEdge(nodes, forward, reverse, edges, src, tgt, "selects", "first call")
	addEdge(nodes, forward, reverse, edges, src, tgt, "selects", "second call")

	// Should only have 1 edge, not 2
	assert.Len(t, *edges, 1, "duplicate edge should be skipped")

	// Both nodes registered
	assert.Contains(t, nodes, refKey(src))
	assert.Contains(t, nodes, refKey(tgt))

	// Adjacency
	assert.True(t, forward[refKey(src)][refKey(tgt)])
	assert.True(t, reverse[refKey(tgt)][refKey(src)])
}

func TestAddEdge_DifferentEdges(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	a := models.ResourceRef{Kind: "Service", Namespace: "ns", Name: "a"}
	b := models.ResourceRef{Kind: "Deployment", Namespace: "ns", Name: "b"}
	c := models.ResourceRef{Kind: "ConfigMap", Namespace: "ns", Name: "c"}

	addEdge(nodes, forward, reverse, edges, a, b, "selects", "")
	addEdge(nodes, forward, reverse, edges, b, c, "mounts", "")

	assert.Len(t, *edges, 2)
	assert.Len(t, nodes, 3)
}

func TestInferSelectorDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-pod-abc",
				Namespace: "default",
				Labels:    map[string]string{"app": "api"},
				OwnerReferences: []metav1.OwnerReference{
					{Kind: "ReplicaSet", Name: "api-deploy-abc123"},
				},
			},
		},
	}

	services := []corev1.Service{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "api-svc", Namespace: "default"},
			Spec: corev1.ServiceSpec{
				Selector: map[string]string{"app": "api"},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{
		"default/api-pod-abc": {Kind: "Deployment", Namespace: "default", Name: "api-deploy"},
	}

	inferSelectorDeps(nodes, forward, reverse, edges, services, pods, podOwners)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "Service", edge.Source.Kind)
	assert.Equal(t, "api-svc", edge.Source.Name)
	assert.Equal(t, "Deployment", edge.Target.Kind)
	assert.Equal(t, "api-deploy", edge.Target.Name)
	assert.Equal(t, "selects", edge.Type)
}

func TestInferSelectorDeps_NoOwner(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "standalone-pod",
				Namespace: "default",
				Labels:    map[string]string{"app": "standalone"},
			},
		},
	}

	services := []corev1.Service{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "standalone-svc", Namespace: "default"},
			Spec: corev1.ServiceSpec{
				Selector: map[string]string{"app": "standalone"},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{} // no owners

	inferSelectorDeps(nodes, forward, reverse, edges, services, pods, podOwners)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "Pod", edge.Target.Kind)
	assert.Equal(t, "standalone-pod", edge.Target.Name)
}

func TestInferEnvVarCrossNamespace(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "order-pod-xyz",
				Namespace: "orders",
				Labels:    map[string]string{"app": "orders"},
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name: "order-container",
						Env: []corev1.EnvVar{
							{
								Name:  "PAYMENT_URL",
								Value: "http://payments-svc.payments.svc.cluster.local:8080",
							},
						},
					},
				},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{
		"orders/order-pod-xyz": {Kind: "Deployment", Namespace: "orders", Name: "order-deploy"},
	}

	services := []corev1.Service{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "payments-svc", Namespace: "payments"},
		},
	}

	inferEnvVarDeps(nodes, forward, reverse, edges, pods, podOwners, services)

	require.Len(t, *edges, 1, "should create exactly one cross-namespace edge")
	edge := (*edges)[0]
	assert.Equal(t, "Deployment", edge.Source.Kind)
	assert.Equal(t, "orders", edge.Source.Namespace)
	assert.Equal(t, "order-deploy", edge.Source.Name)
	assert.Equal(t, "Service", edge.Target.Kind)
	assert.Equal(t, "payments", edge.Target.Namespace)
	assert.Equal(t, "payments-svc", edge.Target.Name)
	assert.Equal(t, "env-dns", edge.Type)
}

func TestInferEnvVarSameNamespace(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "web-pod",
				Namespace: "default",
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name: "web",
						Env: []corev1.EnvVar{
							{Name: "MY_API_SERVICE_HOST", Value: "10.0.0.1"},
							{Name: "MY_API_SERVICE_PORT", Value: "8080"},
						},
					},
				},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{
		"default/web-pod": {Kind: "Deployment", Namespace: "default", Name: "web-deploy"},
	}

	services := []corev1.Service{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "my-api", Namespace: "default"},
		},
	}

	inferEnvVarDeps(nodes, forward, reverse, edges, pods, podOwners, services)

	require.Len(t, *edges, 1, "should detect auto-injected env var reference")
	edge := (*edges)[0]
	assert.Equal(t, "Deployment", edge.Source.Kind)
	assert.Equal(t, "web-deploy", edge.Source.Name)
	assert.Equal(t, "Service", edge.Target.Kind)
	assert.Equal(t, "my-api", edge.Target.Name)
	assert.Equal(t, "env-var", edge.Type)
}

func TestInferOwnerRefDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	deployments := []appsv1.Deployment{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-deploy", Namespace: "default"},
			Spec: appsv1.DeploymentSpec{
				Selector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app": "web"},
				},
			},
		},
	}

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "web-pod-abc",
				Namespace: "default",
				Labels:    map[string]string{"app": "web"},
				OwnerReferences: []metav1.OwnerReference{
					{Kind: "ReplicaSet", Name: "web-deploy-abc123"},
				},
			},
		},
	}

	podOwners := inferOwnerRefDeps(nodes, forward, reverse, edges, pods, deployments, nil, nil)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "Deployment", edge.Source.Kind)
	assert.Equal(t, "web-deploy", edge.Source.Name)
	assert.Equal(t, "Pod", edge.Target.Kind)
	assert.Equal(t, "web-pod-abc", edge.Target.Name)

	owner, ok := podOwners["default/web-pod-abc"]
	require.True(t, ok)
	assert.Equal(t, "Deployment", owner.Kind)
	assert.Equal(t, "web-deploy", owner.Name)
}

func TestInferVolumeMountDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	deployments := []appsv1.Deployment{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "app-deploy", Namespace: "default"},
			Spec: appsv1.DeploymentSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Volumes: []corev1.Volume{
							{
								Name:         "config-vol",
								VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"}}},
							},
							{
								Name:         "secret-vol",
								VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{SecretName: "app-secret"}},
							},
						},
					},
				},
			},
		},
	}

	inferVolumeMountDeps(nodes, forward, reverse, edges, deployments, nil, nil)

	require.Len(t, *edges, 2)

	// Check ConfigMap edge
	found := false
	for _, e := range *edges {
		if e.Target.Kind == "ConfigMap" && e.Target.Name == "app-config" {
			found = true
			assert.Equal(t, "Deployment", e.Source.Kind)
			assert.Equal(t, "mounts", e.Type)
		}
	}
	assert.True(t, found, "ConfigMap edge should exist")

	// Check Secret edge
	found = false
	for _, e := range *edges {
		if e.Target.Kind == "Secret" && e.Target.Name == "app-secret" {
			found = true
		}
	}
	assert.True(t, found, "Secret edge should exist")
}

func TestInferIngressDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	pathType := networkingv1.PathTypePrefix
	ingresses := []networkingv1.Ingress{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-ingress", Namespace: "default"},
			Spec: networkingv1.IngressSpec{
				Rules: []networkingv1.IngressRule{
					{
						Host: "example.com",
						IngressRuleValue: networkingv1.IngressRuleValue{
							HTTP: &networkingv1.HTTPIngressRuleValue{
								Paths: []networkingv1.HTTPIngressPath{
									{
										Path:     "/api",
										PathType: &pathType,
										Backend: networkingv1.IngressBackend{
											Service: &networkingv1.IngressServiceBackend{
												Name: "api-svc",
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	inferIngressDeps(nodes, forward, reverse, edges, ingresses)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "Ingress", edge.Source.Kind)
	assert.Equal(t, "Service", edge.Target.Kind)
	assert.Equal(t, "api-svc", edge.Target.Name)
	assert.Equal(t, "routes", edge.Type)
}

func TestInferIstioDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	vs := []map[string]interface{}{
		{
			"metadata": map[string]interface{}{
				"name":      "orders-vs",
				"namespace": "orders",
			},
			"spec": map[string]interface{}{
				"http": []interface{}{
					map[string]interface{}{
						"route": []interface{}{
							map[string]interface{}{
								"destination": map[string]interface{}{
									"host": "payment-svc.payments.svc.cluster.local",
								},
							},
						},
					},
				},
			},
		},
	}

	inferIstioDeps(nodes, forward, reverse, edges, vs, nil, true)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "VirtualService", edge.Source.Kind)
	assert.Equal(t, "orders", edge.Source.Namespace)
	assert.Equal(t, "Service", edge.Target.Kind)
	assert.Equal(t, "payments", edge.Target.Namespace)
	assert.Equal(t, "payment-svc", edge.Target.Name)
}

func TestInferIstioDeps_Disabled(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	vs := []map[string]interface{}{
		{
			"metadata": map[string]interface{}{"name": "test", "namespace": "ns"},
			"spec":     map[string]interface{}{"http": []interface{}{}},
		},
	}

	inferIstioDeps(nodes, forward, reverse, edges, vs, nil, false)

	assert.Empty(t, *edges, "no edges when Istio is disabled")
}

func TestBuildHPATargets(t *testing.T) {
	hpas := []autoscalingv1.HorizontalPodAutoscaler{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default"},
			Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
				ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
					Kind: "Deployment",
					Name: "web-deploy",
				},
			},
		},
	}

	targets := buildHPATargets(hpas)
	assert.True(t, targets["Deployment/default/web-deploy"])
	assert.Len(t, targets, 1)
}

func TestBuildPDBTargets(t *testing.T) {
	pdbs := []policyv1.PodDisruptionBudget{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-pdb", Namespace: "default"},
			Spec: policyv1.PodDisruptionBudgetSpec{
				Selector: &metav1.LabelSelector{
					MatchLabels: map[string]string{"app": "web"},
				},
			},
		},
	}

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "web-pod",
				Namespace: "default",
				Labels:    map[string]string{"app": "web"},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{
		"default/web-pod": {Kind: "Deployment", Namespace: "default", Name: "web-deploy"},
	}

	targets := buildPDBTargets(pdbs, pods, podOwners)
	assert.True(t, targets["Deployment/default/web-deploy"])
}

func TestBuildIngressHostMap(t *testing.T) {
	pathType := networkingv1.PathTypePrefix
	ingresses := []networkingv1.Ingress{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-ing", Namespace: "default"},
			Spec: networkingv1.IngressSpec{
				Rules: []networkingv1.IngressRule{
					{
						Host: "example.com",
						IngressRuleValue: networkingv1.IngressRuleValue{
							HTTP: &networkingv1.HTTPIngressRuleValue{
								Paths: []networkingv1.HTTPIngressPath{
									{
										Path:     "/",
										PathType: &pathType,
										Backend: networkingv1.IngressBackend{
											Service: &networkingv1.IngressServiceBackend{Name: "web-svc"},
										},
									},
									{
										Path:     "/api",
										PathType: &pathType,
										Backend: networkingv1.IngressBackend{
											Service: &networkingv1.IngressServiceBackend{Name: "api-svc"},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	hostMap := buildIngressHostMap(ingresses)
	assert.Contains(t, hostMap, "Service/default/web-svc")
	assert.Contains(t, hostMap["Service/default/web-svc"], "example.com/")
	assert.Contains(t, hostMap, "Service/default/api-svc")
	assert.Contains(t, hostMap["Service/default/api-svc"], "example.com/api")
}

func TestInferNetworkPolicyDeps(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	netpols := []networkingv1.NetworkPolicy{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "deny-all", Namespace: "default"},
			Spec: networkingv1.NetworkPolicySpec{
				PodSelector: metav1.LabelSelector{
					MatchLabels: map[string]string{"app": "web"},
				},
			},
		},
	}

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "web-pod",
				Namespace: "default",
				Labels:    map[string]string{"app": "web"},
			},
		},
	}

	podOwners := map[string]models.ResourceRef{
		"default/web-pod": {Kind: "Deployment", Namespace: "default", Name: "web-deploy"},
	}

	inferNetworkPolicyDeps(nodes, forward, reverse, edges, netpols, pods, podOwners)

	require.Len(t, *edges, 1)
	edge := (*edges)[0]
	assert.Equal(t, "NetworkPolicy", edge.Source.Kind)
	assert.Equal(t, "Deployment", edge.Target.Kind)
	assert.Equal(t, "network-policy", edge.Type)
}
