package rest

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestGetTracingDiagnostics_NoNamespace(t *testing.T) {
	clientset := fake.NewSimpleClientset()
	h := &TracingHandler{}
	resp := h.computeDiagnostics(context.Background(), clientset, "test-cluster")

	foundNs := false
	for _, c := range resp.Checks {
		if !c.Passed && c.Name == "kubilitics-system namespace exists" {
			foundNs = true
			if len(c.LikelyCauses) == 0 {
				t.Error("expected likely_causes for namespace_missing")
			}
		}
	}
	if !foundNs {
		t.Error("expected a failed namespace check")
	}
}

func TestGetTracingDiagnostics_CollectorReadyNoSpans(t *testing.T) {
	one := int32(1)
	clientset := fake.NewSimpleClientset(
		&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kubilitics-system"}},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "otel-collector", Namespace: "kubilitics-system"},
			Spec:       appsv1.DeploymentSpec{Replicas: &one},
			Status:     appsv1.DeploymentStatus{Replicas: 1, ReadyReplicas: 1},
		},
	)
	h := &TracingHandler{}
	resp := h.computeDiagnostics(context.Background(), clientset, "test-cluster")

	for _, c := range resp.Checks {
		if c.Name == "Collector deployment running" && !c.Passed {
			t.Errorf("expected collector check to pass, got: %+v", c)
		}
	}
	hasNoSpansCause := false
	for _, c := range resp.Checks {
		if c.Name == "Spans received in last 5 minutes" && !c.Passed {
			for _, cause := range c.LikelyCauses {
				if cause.Signature == "no_spans_no_instrumented_apps" {
					hasNoSpansCause = true
				}
			}
		}
	}
	if !hasNoSpansCause {
		t.Error("expected no_spans_no_instrumented_apps in likely causes")
	}
}

func TestGetInstrumentCommand_PythonDeployment(t *testing.T) {
	one := int32(1)
	clientset := fake.NewSimpleClientset(&appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "my-app", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Replicas: &one,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:    "main",
						Image:   "python:3.11-slim",
						Command: []string{"python3"},
						Args:    []string{"app.py"},
					}},
				},
			},
		},
	})

	h := &TracingHandler{}
	resp, err := h.computeInstrumentCommand(context.Background(), clientset, "test-cluster", "default", "my-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(resp.Containers))
	}
	if resp.Containers[0].DetectedLanguage != "python" {
		t.Errorf("expected python, got %s", resp.Containers[0].DetectedLanguage)
	}
	if !resp.Containers[0].SupportsAuto {
		t.Error("expected python to support auto-instrumentation")
	}
	if !strings.Contains(resp.Command, "inject-python") {
		t.Errorf("expected python annotation in command, got: %s", resp.Command)
	}
	if !strings.Contains(resp.Command, "annotate deployment my-app") {
		t.Errorf("expected target deployment in command, got: %s", resp.Command)
	}
}

func TestGetInstrumentCommand_RustDeployment_ReturnsManualGuide(t *testing.T) {
	one := int32(1)
	clientset := fake.NewSimpleClientset(&appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "rust-app", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Replicas: &one,
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:  "main",
						Image: "rust:1.74",
					}},
				},
			},
		},
	})

	h := &TracingHandler{}
	resp, err := h.computeInstrumentCommand(context.Background(), clientset, "test-cluster", "default", "rust-app")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Containers[0].SupportsAuto {
		t.Error("expected rust to NOT support auto-instrumentation")
	}
	if resp.Command != "" {
		t.Errorf("expected empty command for unsupported language, got: %s", resp.Command)
	}
	if resp.ManualGuide == nil || resp.ManualGuide.Language != "rust" {
		t.Error("expected rust manual_guide to be populated")
	}
}
