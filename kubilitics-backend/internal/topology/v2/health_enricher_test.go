package v2

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestHealthEnricher_PodRunning(t *testing.T) {
	bundle := &ResourceBundle{
		Pods: []corev1.Pod{{
			ObjectMeta: metav1.ObjectMeta{Name: "test-pod", Namespace: "default"},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				ContainerStatuses: []corev1.ContainerStatus{{Ready: true}},
			},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Pod", "default", "test-pod"), Kind: "Pod", Name: "test-pod", Namespace: "default"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "healthy" {
		t.Errorf("expected healthy, got %s", nodes[0].Status)
	}
	if nodes[0].StatusReason != "Running" {
		t.Errorf("expected Running, got %s", nodes[0].StatusReason)
	}
}

func TestHealthEnricher_PodFailed(t *testing.T) {
	bundle := &ResourceBundle{
		Pods: []corev1.Pod{{
			ObjectMeta: metav1.ObjectMeta{Name: "fail-pod", Namespace: "default"},
			Status: corev1.PodStatus{Phase: corev1.PodFailed, Reason: "OOMKilled"},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Pod", "default", "fail-pod"), Kind: "Pod", Name: "fail-pod", Namespace: "default"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "error" {
		t.Errorf("expected error, got %s", nodes[0].Status)
	}
}

func TestHealthEnricher_PodPending(t *testing.T) {
	bundle := &ResourceBundle{
		Pods: []corev1.Pod{{
			ObjectMeta: metav1.ObjectMeta{Name: "pending-pod", Namespace: "default"},
			Status: corev1.PodStatus{Phase: corev1.PodPending},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Pod", "default", "pending-pod"), Kind: "Pod", Name: "pending-pod", Namespace: "default"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "warning" {
		t.Errorf("expected warning, got %s", nodes[0].Status)
	}
}

func TestHealthEnricher_PodHighRestarts(t *testing.T) {
	bundle := &ResourceBundle{
		Pods: []corev1.Pod{{
			ObjectMeta: metav1.ObjectMeta{Name: "restart-pod", Namespace: "default"},
			Status: corev1.PodStatus{
				Phase: corev1.PodRunning,
				ContainerStatuses: []corev1.ContainerStatus{{Ready: true, RestartCount: 10}},
			},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Pod", "default", "restart-pod"), Kind: "Pod", Name: "restart-pod", Namespace: "default"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "warning" {
		t.Errorf("expected warning, got %s", nodes[0].Status)
	}
	if nodes[0].StatusReason != "HighRestartCount" {
		t.Errorf("expected HighRestartCount, got %s", nodes[0].StatusReason)
	}
}

func TestHealthEnricher_NodeReady(t *testing.T) {
	bundle := &ResourceBundle{
		Nodes: []corev1.Node{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
			Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
			},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Node", "", "node-1"), Kind: "Node", Name: "node-1"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "healthy" {
		t.Errorf("expected healthy, got %s", nodes[0].Status)
	}
}

func TestHealthEnricher_NodeNotReady(t *testing.T) {
	bundle := &ResourceBundle{
		Nodes: []corev1.Node{{
			ObjectMeta: metav1.ObjectMeta{Name: "node-2"},
			Status: corev1.NodeStatus{
				Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionFalse}},
			},
		}},
	}
	nodes := []TopologyNode{{ID: NodeID("Node", "", "node-2"), Kind: "Node", Name: "node-2"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, bundle)
	if nodes[0].Status != "error" {
		t.Errorf("expected error, got %s", nodes[0].Status)
	}
}

func TestHealthEnricher_NilBundle(t *testing.T) {
	nodes := []TopologyNode{{ID: "Pod/default/test", Kind: "Pod", Name: "test"}}
	enricher := &HealthEnricher{}
	enricher.EnrichNodes(nodes, nil)
	// Should not panic, status unchanged
}
