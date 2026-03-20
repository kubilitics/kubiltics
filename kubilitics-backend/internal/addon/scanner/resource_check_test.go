package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestResourceChecker_Run(t *testing.T) {
	ctx := context.Background()

	addonNoCost := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{ID: "addon-1", Name: "myaddon"},
	}
	addonWithCost := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{ID: "addon-1", Name: "myaddon"},
		CostModels: []models.AddOnCostModel{
			{ClusterTier: "dev", CPUMillicores: 100, MemoryMB: 128},
		},
	}

	nodeStatus := corev1.NodeStatus{
		Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
		},
		Allocatable: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("2000m"),
			corev1.ResourceMemory: resource.MustParse("4Gi"),
		},
	}

	podSpec := corev1.PodSpec{
		Containers: []corev1.Container{
			{
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
				},
			},
		},
	}

	// Case 1: No cost model
	checker := &ResourceChecker{}
	clientsetEmpty := fake.NewSimpleClientset()
	inputNoCost := CheckInput{
		AddonDetail: addonNoCost,
		K8sClient:   clientsetEmpty,
	}
	res, err := checker.Run(ctx, inputNoCost)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "unavailable")

	// Case 2: Sufficient resources
	clientsetSufficient := fake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node1"}, Status: nodeStatus},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod1", Namespace: "default"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}, Spec: podSpec},
	)
	inputSufficient := CheckInput{
		AddonDetail: addonWithCost,
		K8sClient:   clientsetSufficient,
	}
	res, err = checker.Run(ctx, inputSufficient)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)
	assert.Contains(t, res[0].Title, "sufficient")

	// Case 3: Low resources (Mem and CPU)
	smallNodeStatus := corev1.NodeStatus{
		Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
		},
		Allocatable: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse("150m"),  // Will leave 50m available after pod
			corev1.ResourceMemory: resource.MustParse("200Mi"), // Will leave 72Mi available
		},
	}
	clientsetLow := fake.NewSimpleClientset(
		&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node1"}, Status: smallNodeStatus},
		&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod1", Namespace: "default"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}, Spec: podSpec},
	)
	inputLow := CheckInput{
		AddonDetail: addonWithCost,
		K8sClient:   clientsetLow,
	}
	res, err = checker.Run(ctx, inputLow)
	assert.NoError(t, err)
	assert.Len(t, res, 2)
	for _, r := range res {
		assert.Equal(t, models.PreflightWARN, r.Status)
		assert.Contains(t, r.Title, "Low")
	}
}
