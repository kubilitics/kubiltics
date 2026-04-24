package server

// handlers_security_checks_test.go — Phase 3 Category 4 tests.

import (
	"context"
	"testing"
)

func TestCheckPrivilegedContainers_Flags(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": "demo", "name": "bad"},
				"spec": map[string]interface{}{
					"hostNetwork": true,
					"containers": []interface{}{
						map[string]interface{}{"name": "c", "securityContext": map[string]interface{}{"privileged": true}},
					},
				},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": "demo", "name": "good"},
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{"name": "c", "securityContext": map[string]interface{}{"privileged": false}},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeSecurityTool(context.Background(), "check_privileged_containers", map[string]interface{}{})
	if err != nil {
		t.Fatalf("%v", err)
	}
	res := out.(*securityCheckResult)
	if len(res.Findings) < 2 {
		t.Errorf("expected >=2 findings (privileged + hostNetwork), got %d: %+v", len(res.Findings), res.Findings)
	}
}

func TestCheckImageTagLatest_Flags(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"namespace": "demo", "name": "p"},
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{"name": "c", "image": "nginx:latest"},
						map[string]interface{}{"name": "c2", "image": "nginx:1.27"},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeSecurityTool(context.Background(), "check_image_tag_latest", map[string]interface{}{})
	if err != nil {
		t.Fatalf("%v", err)
	}
	res := out.(*securityCheckResult)
	if len(res.Findings) != 1 {
		t.Errorf("expected 1 finding, got %d", len(res.Findings))
	}
}

func TestCheckRBACWildcards_Flags(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/clusterroles", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "god"},
				"rules": []interface{}{
					map[string]interface{}{"verbs": []interface{}{"*"}, "resources": []interface{}{"*"}},
				},
			},
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "nice"},
				"rules": []interface{}{
					map[string]interface{}{"verbs": []interface{}{"get", "list"}, "resources": []interface{}{"pods"}},
				},
			},
		},
	})
	fb.register("/clusters/"+testClusterID+"/resources/roles", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.routeSecurityTool(context.Background(), "check_rbac_wildcards", map[string]interface{}{})
	if err != nil {
		t.Fatalf("%v", err)
	}
	res := out.(*securityCheckResult)
	if len(res.Findings) != 1 {
		t.Errorf("expected 1 wildcard role, got %d", len(res.Findings))
	}
}

func TestSecurityChecks_DispatchRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/ingresses", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/clusterroles", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/roles", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	checks := []string{
		"check_privileged_containers", "check_root_containers", "check_writable_root_fs",
		"check_capabilities_all_added", "check_host_path_mounts",
		"check_default_service_accounts_in_use", "check_secrets_in_env",
		"check_image_tag_latest", "check_ingress_tls_expiry_30d", "check_rbac_wildcards",
	}
	for _, name := range checks {
		t.Run(name, func(t *testing.T) {
			out, err := s.routeSecurityTool(context.Background(), name, map[string]interface{}{})
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if _, ok := out.(*securityCheckResult); !ok {
				t.Errorf("%s: expected securityCheckResult, got %T", name, out)
			}
		})
	}
}
