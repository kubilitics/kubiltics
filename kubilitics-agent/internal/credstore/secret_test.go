package credstore

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestSaveAndLoad(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := New(cs, "kubilitics-system", "kubilitics-agent-creds")
	creds := Creds{ClusterID: "c1", RefreshToken: "rk_live_abc", AccessToken: "eyJ", AccessTTLs: 3600}
	if err := s.Save(context.Background(), creds); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != creds {
		t.Fatalf("got %+v", got)
	}

	if _, err := cs.CoreV1().Secrets("kubilitics-system").Get(context.Background(), "kubilitics-agent-creds", metav1.GetOptions{}); err != nil {
		t.Fatal(err)
	}
}

func TestLoadMissing(t *testing.T) {
	cs := fake.NewSimpleClientset()
	s := New(cs, "ns", "name")
	if _, err := s.Load(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}
