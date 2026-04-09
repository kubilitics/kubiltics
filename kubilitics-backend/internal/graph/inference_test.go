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

// --- C-BE-3: After addEdge(A, B), both A and B exist as keys in forward AND reverse ---

func TestAddEdge_SymmetricMapKeys(t *testing.T) {
	nodes, forward, reverse, edges := newGraphState()

	a := models.ResourceRef{Kind: "Service", Namespace: "ns", Name: "a"}
	b := models.ResourceRef{Kind: "Deployment", Namespace: "ns", Name: "b"}

	addEdge(nodes, forward, reverse, edges, a, b, "selects", "test")

	aKey := refKey(a)
	bKey := refKey(b)

	// Both A and B must exist as keys in BOTH forward and reverse maps.
	_, aInForward := forward[aKey]
	assert.True(t, aInForward, "source A must exist as key in forward map")
	_, bInForward := forward[bKey]
	assert.True(t, bInForward, "target B must also exist as key in forward map")

	_, aInReverse := reverse[aKey]
	assert.True(t, aInReverse, "source A must also exist as key in reverse map")
	_, bInReverse := reverse[bKey]
	assert.True(t, bInReverse, "target B must exist as key in reverse map")

	// The actual edge: A->B in forward, B<-A in reverse
	assert.True(t, forward[aKey][bKey], "forward[A][B] should be true")
	assert.True(t, reverse[bKey][aKey], "reverse[B][A] should be true")

	// A should have empty set in reverse (no one depends on A yet)
	assert.Empty(t, reverse[aKey], "reverse[A] should be empty (no incoming edges to A)")
	// B should have empty set in forward (B has no outgoing edges yet)
	assert.Empty(t, forward[bKey], "forward[B] should be empty (no outgoing edges from B)")
}

