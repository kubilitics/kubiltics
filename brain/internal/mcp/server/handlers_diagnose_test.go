package server

// handlers_diagnose_test.go — happy-path tests for Phase 3 Category 2.

import (
	"context"
	"testing"
)

func TestDiagnosePodNotReady_CrashLoopDetected(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pods/demo/app-1", map[string]interface{}{
		"status": map[string]interface{}{
			"phase": "Running",
			"containerStatuses": []interface{}{
				map[string]interface{}{
					"name":         "app",
					"ready":        false,
					"restartCount": 7.0,
					"state": map[string]interface{}{
						"waiting": map[string]interface{}{"reason": "CrashLoopBackOff"},
					},
				},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnosePodNotReady(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "app-1",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.Healthy {
		t.Error("expected unhealthy")
	}
	if d.ProbableCause == "" {
		t.Error("expected probable cause")
	}
}

func TestDiagnoseServiceNoEndpoints_SelectorMatchesNone(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/services/demo/api", map[string]interface{}{
		"spec": map[string]interface{}{"selector": map[string]interface{}{"app": "api"}},
	})
	fb.register("/clusters/"+testClusterID+"/resources/endpoints/demo/api", map[string]interface{}{
		"subsets": []interface{}{},
	})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseServiceNoEndpoints(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "api",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.Healthy {
		t.Error("expected unhealthy")
	}
}

func TestDiagnosePVCPending_NoStorageClass(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/pvcs/demo/data", map[string]interface{}{
		"status": map[string]interface{}{"phase": "Pending"},
		"spec":   map[string]interface{}{}, // no storageClassName
	})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnosePVCPending(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "data",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause != "no_storage_class" {
		t.Errorf("expected no_storage_class, got %q", d.ProbableCause)
	}
}

func TestDiagnoseIngress404_BackendServiceMissing(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/ingresses/demo/web", map[string]interface{}{
		"spec": map[string]interface{}{
			"rules": []interface{}{
				map[string]interface{}{
					"http": map[string]interface{}{
						"paths": []interface{}{
							map[string]interface{}{
								"backend": map[string]interface{}{
									"service": map[string]interface{}{"name": "missing-svc"},
								},
							},
						},
					},
				},
			},
		},
	})
	// missing-svc NOT registered
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseIngress404(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "web",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause != "backend_service_missing" {
		t.Errorf("expected backend_service_missing, got %q", d.ProbableCause)
	}
}

func TestDiagnoseDeploymentRollbackNeeded_DegradedWithHistory(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/deployments/demo/web", map[string]interface{}{
		"status": map[string]interface{}{"replicas": 3.0, "readyReplicas": 1.0},
	})
	fb.register("/clusters/"+testClusterID+"/resources/deployments/demo/web/rollout-history", map[string]interface{}{
		"revisions": []interface{}{
			map[string]interface{}{"revision": 3.0, "changeCause": "bad image"},
			map[string]interface{}{"revision": 2.0, "changeCause": "stable release"},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseDeploymentRollbackNeeded(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "web",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.Healthy {
		t.Error("expected unhealthy")
	}
}

func TestDiagnoseCronJobMissingRuns_Suspended(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/cronjobs/demo/backup", map[string]interface{}{
		"spec":   map[string]interface{}{"suspend": true, "schedule": "0 * * * *"},
		"status": map[string]interface{}{},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseCronJobMissingRuns(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "backup",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause != "suspended" {
		t.Errorf("expected suspended, got %q", d.ProbableCause)
	}
}

func TestDiagnoseNodeUnschedulable_Cordoned(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/nodes/node-a", map[string]interface{}{
		"spec":   map[string]interface{}{"unschedulable": true},
		"status": map[string]interface{}{"conditions": []interface{}{}},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseNodeUnschedulable(context.Background(), map[string]interface{}{"name": "node-a"})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause != "cordoned" {
		t.Errorf("expected cordoned, got %q", d.ProbableCause)
	}
}

func TestDiagnoseHPANotScaling_MinEqualsMax(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/hpas/demo/web-hpa", map[string]interface{}{
		"spec":   map[string]interface{}{"minReplicas": 3.0, "maxReplicas": 3.0},
		"status": map[string]interface{}{"conditions": []interface{}{}},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseHPANotScaling(context.Background(), map[string]interface{}{
		"namespace": "demo", "name": "web-hpa",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause != "min_equals_max" {
		t.Errorf("expected min_equals_max, got %q", d.ProbableCause)
	}
}

func TestDiagnoseNetworkPolicyBlocking_DefaultDeny(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/resources/networkpolicies", map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{
				"metadata": map[string]interface{}{"name": "default-deny"},
				"spec":     map[string]interface{}{"podSelector": map[string]interface{}{}},
			},
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseNetworkPolicyBlocking(context.Background(), map[string]interface{}{
		"namespace": "demo", "from_pod": "a", "to_pod": "b",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.ProbableCause == "" {
		t.Error("expected probable cause")
	}
}

func TestDiagnoseCertificateFailures_EventBased(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{
		map[string]interface{}{
			"reason":         "Failed",
			"lastTimestamp":  recentIsoAgo(10),
			"involvedObject": map[string]interface{}{"kind": "Certificate", "name": "tls", "namespace": "demo"},
			"message":        "issuer not found",
		},
	})
	s := newTestServer(t, fb.server.URL)
	out, err := s.handleDiagnoseCertificateFailures(context.Background(), map[string]interface{}{
		"namespace": "demo",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	d := out.(*diagnosticResult)
	if d.Healthy {
		t.Error("expected unhealthy")
	}
}

func TestDiagnose_DispatchRegistered(t *testing.T) {
	fb := newFakeBackend(t)
	fb.registerCluster()
	// Register minimal stubs so each diagnose_* doesn't 500 on missing route.
	fb.register("/clusters/"+testClusterID+"/resources/pods/demo/p", map[string]interface{}{"status": map[string]interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/services/demo/s", map[string]interface{}{"spec": map[string]interface{}{"selector": map[string]interface{}{"a": "b"}}})
	fb.register("/clusters/"+testClusterID+"/resources/endpoints/demo/s", map[string]interface{}{"subsets": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pods", map[string]interface{}{"items": []interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/pvcs/demo/p", map[string]interface{}{"status": map[string]interface{}{"phase": "Bound"}})
	fb.register("/clusters/"+testClusterID+"/events", []interface{}{})
	fb.register("/clusters/"+testClusterID+"/resources/ingresses/demo/i", map[string]interface{}{"spec": map[string]interface{}{"rules": []interface{}{}}})
	fb.register("/clusters/"+testClusterID+"/resources/deployments/demo/d", map[string]interface{}{"status": map[string]interface{}{"replicas": 1.0, "readyReplicas": 1.0}})
	fb.register("/clusters/"+testClusterID+"/resources/cronjobs/demo/c", map[string]interface{}{"spec": map[string]interface{}{"schedule": "*", "suspend": false}, "status": map[string]interface{}{"lastScheduleTime": "x"}})
	fb.register("/clusters/"+testClusterID+"/resources/nodes/n", map[string]interface{}{"spec": map[string]interface{}{}, "status": map[string]interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/hpas/demo/h", map[string]interface{}{"spec": map[string]interface{}{"minReplicas": 1.0, "maxReplicas": 3.0}, "status": map[string]interface{}{}})
	fb.register("/clusters/"+testClusterID+"/resources/networkpolicies", map[string]interface{}{"items": []interface{}{}})
	s := newTestServer(t, fb.server.URL)

	cases := []struct {
		name string
		args map[string]interface{}
	}{
		{"diagnose_pod_not_ready", map[string]interface{}{"namespace": "demo", "name": "p"}},
		{"diagnose_service_no_endpoints", map[string]interface{}{"namespace": "demo", "name": "s"}},
		{"diagnose_pvc_pending", map[string]interface{}{"namespace": "demo", "name": "p"}},
		{"diagnose_ingress_404", map[string]interface{}{"namespace": "demo", "name": "i"}},
		{"diagnose_deployment_rollback_needed", map[string]interface{}{"namespace": "demo", "name": "d"}},
		{"diagnose_cronjob_missing_runs", map[string]interface{}{"namespace": "demo", "name": "c"}},
		{"diagnose_node_unschedulable", map[string]interface{}{"name": "n"}},
		{"diagnose_hpa_not_scaling", map[string]interface{}{"namespace": "demo", "name": "h"}},
		{"diagnose_networkpolicy_blocking", map[string]interface{}{"namespace": "demo"}},
		{"diagnose_certificate_failures", map[string]interface{}{"namespace": "demo"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.routeTroubleshootingTool(context.Background(), c.name, c.args)
			if err != nil {
				t.Fatalf("%s dispatch failed: %v", c.name, err)
			}
		})
	}
}
