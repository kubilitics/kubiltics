package cli

import (
	"testing"
)

func TestParseResourceRef(t *testing.T) {
	tests := []struct {
		in       string
		wantKind string
		wantName string
		wantErr  bool
	}{
		{"pod/my-pod", "Pod", "my-pod", false},
		{"deployment/api", "Deployment", "api", false},
		{"Pod/crashed-payment", "Pod", "crashed-payment", false},
		{"po/nginx", "Pod", "nginx", false},
		{"deploy/web", "Deployment", "web", false},
		{"node/minikube", "Node", "minikube", false},
		{"", "", "", true},
		{"invalid", "", "", true},
		{"pod/", "", "", true},
		{"/name", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			kind, name, err := parseResourceRef(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseResourceRef(%q) err = %v, wantErr %v", tt.in, err, tt.wantErr)
				return
			}
			if !tt.wantErr && (kind != tt.wantKind || name != tt.wantName) {
				t.Errorf("parseResourceRef(%q) = %q, %q; want %q, %q", tt.in, kind, name, tt.wantKind, tt.wantName)
			}
		})
	}
}
