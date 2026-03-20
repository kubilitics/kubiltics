package validate

import "testing"

func TestClusterID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"", false},
		{"cluster-1", true},
		{"prod_us-east_2", true},
		{"a", true},
		{string(make([]byte, ClusterIDMaxLen+1)), false},
		{"bad/id", false},
		{"bad.id", false},
	}
	for _, tt := range tests {
		if got := ClusterID(tt.id); got != tt.want {
			t.Errorf("ClusterID(%q) = %v, want %v", tt.id, got, tt.want)
		}
	}
}

func TestKind(t *testing.T) {
	tests := []struct {
		kind string
		want bool
	}{
		{"", false},
		{"pods", true},
		{"deployments", true},
		{"ConfigMap", true},
		{"bad/kind", false},
	}
	for _, tt := range tests {
		if got := Kind(tt.kind); got != tt.want {
			t.Errorf("Kind(%q) = %v, want %v", tt.kind, got, tt.want)
		}
	}
}

func TestNamespace(t *testing.T) {
	tests := []struct {
		ns   string
		want bool
	}{
		{"", true},
		{"default", true},
		{"kube-system", true},
		{"my-ns", true},
		{"Bad", true}, // ToLower applied
		{"bad_ns", false},
	}
	for _, tt := range tests {
		if got := Namespace(tt.ns); got != tt.want {
			t.Errorf("Namespace(%q) = %v, want %v", tt.ns, got, tt.want)
		}
	}
}

func TestName(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"", false},
		{"my-pod", true},
		{"nginx", true},
		{"bad/name", false},
	}
	for _, tt := range tests {
		if got := Name(tt.name); got != tt.want {
			t.Errorf("Name(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}
