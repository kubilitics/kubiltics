package graph

import "testing"

func TestIsCriticalSystemComponent(t *testing.T) {
	tests := []struct {
		name      string
		kind      string
		namespace string
		resName   string
		wantMatch bool
		wantScope string
	}{
		{"coredns deployment", "Deployment", "kube-system", "coredns", true, "cluster-wide"},
		{"kube-proxy daemonset", "DaemonSet", "kube-system", "kube-proxy", true, "node-level"},
		{"etcd pod", "Pod", "kube-system", "etcd-control-plane", true, "control-plane"},
		{"kube-apiserver", "Pod", "kube-system", "kube-apiserver-control-plane", true, "control-plane"},
		{"metrics-server", "Deployment", "kube-system", "metrics-server", true, "cluster-wide"},
		{"user workload in kube-system", "Deployment", "kube-system", "my-custom-thing", false, ""},
		{"coredns in wrong namespace", "Deployment", "default", "coredns", false, ""},
		{"random app", "Deployment", "default", "my-app", false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			comp, ok := matchCriticalComponent(tt.namespace, tt.resName)
			if ok != tt.wantMatch {
				t.Errorf("matchCriticalComponent(%s, %s) matched=%v, want %v", tt.namespace, tt.resName, ok, tt.wantMatch)
			}
			if ok && comp.ImpactScope != tt.wantScope {
				t.Errorf("scope=%s, want %s", comp.ImpactScope, tt.wantScope)
			}
		})
	}
}

func TestIsKubeSystemResource(t *testing.T) {
	if !isKubeSystemResource("kube-system") {
		t.Error("expected kube-system to be true")
	}
	if isKubeSystemResource("default") {
		t.Error("expected default to be false")
	}
}
