package discovery

import (
	"context"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestSecretSource_EnumerateLabeledSecrets(t *testing.T) {
	cs := fake.NewSimpleClientset(
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name: "cluster-prod", Namespace: "kubilitics",
				Labels: map[string]string{"kubilitics.io/cluster-kubeconfig": "true"},
				Annotations: map[string]string{
					"kubilitics.io/cluster-name":       "prod",
					"kubilitics.io/cluster-server-url": "https://prod:6443",
				},
			},
		},
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "unrelated", Namespace: "kubilitics"},
		},
	)
	s := NewKubernetesSecretSource(cs, "kubilitics")
	got, err := s.Enumerate(context.Background())
	if err != nil {
		t.Fatalf("enum: %v", err)
	}
	if len(got) != 1 || got[0].Identity.Name != "prod" {
		t.Fatalf("expected 1 prod cluster: %+v", got)
	}
}

func TestSecretSource_WatchEmitsAddOnNewSecret(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := NewKubernetesSecretSource(cs, "kubilitics")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ch, err := s.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	_, _ = cs.CoreV1().Secrets("kubilitics").Create(ctx, &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: "new", Namespace: "kubilitics",
			Labels: map[string]string{"kubilitics.io/cluster-kubeconfig": "true"},
			Annotations: map[string]string{
				"kubilitics.io/cluster-name":       "new",
				"kubilitics.io/cluster-server-url": "https://new:6443",
			},
		},
	}, metav1.CreateOptions{})

	select {
	case e := <-ch:
		if e.Kind != EventAdd || e.Cluster.Identity.Name != "new" {
			t.Fatalf("unexpected event: %+v", e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no event within 2s")
	}
}
