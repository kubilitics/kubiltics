package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	policyv1 "k8s.io/api/policy/v1"
)

func TestComputeResilience_WellProtected(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 5, HasHPA: true, HasPDB: true, HasController: true,
	})
	if detail.Score < 80 {
		t.Errorf("expected resilience >= 80 for well-protected deployment, got %d", detail.Score)
	}
}

func TestComputeResilience_SingleReplica(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 1, HasHPA: false, HasPDB: false, HasController: true,
	})
	if detail.Score > 70 {
		t.Errorf("expected resilience <= 70 for single replica no HPA/PDB, got %d", detail.Score)
	}
}

func TestComputeResilience_NakedPod(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "Pod", Replicas: 0, HasHPA: false, HasPDB: false, HasController: false,
	})
	if detail.Score > 80 {
		t.Errorf("expected low resilience for naked pod, got %d", detail.Score)
	}
}

func TestComputeResilience_DaemonSet(t *testing.T) {
	detail := computeResilience(ResilienceInput{
		Kind: "DaemonSet", Replicas: 10, HasHPA: false, HasPDB: false, HasController: true,
	})
	if detail.Score < 70 {
		t.Errorf("expected DaemonSet resilience >= 70, got %d", detail.Score)
	}
}

func TestComputeExposure_IngressExposed(t *testing.T) {
	detail := computeExposure(ExposureInput{
		IsIngressExposed: true, ConsumerCount: 3, CrossNsCount: 2,
		TraceDataAvailable: true, IsCriticalSystem: false,
	})
	if detail.Score < 50 {
		t.Errorf("expected high exposure for ingress+consumers, got %d", detail.Score)
	}
}

func TestComputeExposure_CriticalSystem(t *testing.T) {
	detail := computeExposure(ExposureInput{
		IsIngressExposed: false, ConsumerCount: 0, CrossNsCount: 1,
		TraceDataAvailable: false, IsCriticalSystem: true,
	})
	if detail.Score < 80 {
		t.Errorf("expected critical system exposure >= 80, got %d", detail.Score)
	}
}

func TestComputeRecovery_StatefulSet(t *testing.T) {
	detail := computeRecovery(RecoveryInput{
		Kind: "StatefulSet", Replicas: 3, HasController: true, HasPVC: true, IsControlPlane: false,
	})
	if detail.Score > 70 {
		t.Errorf("expected StatefulSet recovery < 70, got %d", detail.Score)
	}
}

func TestComputeOverallCriticality_LowImpact(t *testing.T) {
	scores := models.SubScores{
		Resilience: models.SubScoreDetail{Score: 50},
		Exposure:   models.SubScoreDetail{Score: 5},
		Recovery:   models.SubScoreDetail{Score: 90},
		Impact:     models.SubScoreDetail{Score: 0},
	}
	crit := computeOverallCriticality(scores)
	if crit > 25 {
		t.Errorf("expected low criticality for zero-impact workload, got %.1f", crit)
	}
}

func TestComputeOverallCriticality_HighImpact(t *testing.T) {
	scores := models.SubScores{
		Resilience: models.SubScoreDetail{Score: 10},
		Exposure:   models.SubScoreDetail{Score: 80},
		Recovery:   models.SubScoreDetail{Score: 20},
		Impact:     models.SubScoreDetail{Score: 80},
	}
	crit := computeOverallCriticality(scores)
	if crit < 60 {
		t.Errorf("expected high criticality for high-impact exposed workload, got %.1f", crit)
	}
}

func TestCriticalityLevelV2(t *testing.T) {
	tests := []struct {
		score float64
		want  string
	}{
		{80, "critical"}, {55, "high"}, {30, "medium"}, {10, "low"},
	}
	for _, tt := range tests {
		got := criticalityLevelV2(tt.score)
		if got != tt.want {
			t.Errorf("criticalityLevelV2(%.0f) = %s, want %s", tt.score, got, tt.want)
		}
	}
}

func TestComputeResilience_ZeroReplicas(t *testing.T) {
	zero := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 0, HasHPA: false, HasPDB: false, HasController: true,
	})
	one := computeResilience(ResilienceInput{
		Kind: "Deployment", Replicas: 1, HasHPA: false, HasPDB: false, HasController: true,
	})
	if zero.Score >= one.Score {
		t.Errorf("expected 0 replicas (%d) to score lower than 1 replica (%d)", zero.Score, one.Score)
	}
}

func TestComputeExposure_CrossNamespace(t *testing.T) {
	detail := computeExposure(ExposureInput{
		IsIngressExposed: false, ConsumerCount: 0, CrossNsCount: 2,
		K8sFanIn: 0, TraceDataAvailable: false, IsCriticalSystem: false,
	})
	if detail.Score < 10 {
		t.Errorf("expected CrossNsCount=2 to give exposure >= 10, got %d", detail.Score)
	}
}

func TestComputeExposure_TrafficWeighted(t *testing.T) {
	// High-traffic service: 10000 calls out of 50000 total = 20% of cluster traffic
	highTraffic := computeExposure(ExposureInput{
		IsIngressExposed:   false,
		ConsumerCount:      2,
		TraceDataAvailable: true,
		TotalCallsToTarget: 10000,
		ClusterTotalCalls:  50000,
	})

	// Low-traffic service: same consumer count but only 100 calls
	lowTraffic := computeExposure(ExposureInput{
		IsIngressExposed:   false,
		ConsumerCount:      2,
		TraceDataAvailable: true,
		TotalCallsToTarget: 100,
		ClusterTotalCalls:  50000,
	})

	if highTraffic.Score <= lowTraffic.Score {
		t.Errorf("high-traffic service (%d) should score higher than low-traffic (%d)",
			highTraffic.Score, lowTraffic.Score)
	}
}

func TestComputeExposure_TrafficWeighted_NoCallData(t *testing.T) {
	// Trace available but no call counts — should fall back to consumer count
	detail := computeExposure(ExposureInput{
		IsIngressExposed:   false,
		ConsumerCount:      3,
		TraceDataAvailable: true,
		TotalCallsToTarget: 0,
		ClusterTotalCalls:  0,
	})
	if detail.Score < 20 {
		t.Errorf("fallback to consumer count should give decent score, got %d", detail.Score)
	}
}

func TestComputeConfidence_FullData(t *testing.T) {
	snap := buildSnapshotScenario1()
	snap.PDBs = []policyv1.PodDisruptionBudget{{}} // just need non-empty
	snap.NodeHasHPA["Deployment/default/app"] = true
	snap.TotalWorkloads = 15

	score, note := computeConfidence(snap)
	// endpoints(30) + PDBs(15) + HPAs(10) + large cluster(15) = 70 (no traces)
	if score < 60 {
		t.Errorf("full data minus traces should score >= 60, got %d", score)
	}
	if note == "" {
		t.Error("note should not be empty")
	}
}

func TestComputeConfidence_GraphOnly(t *testing.T) {
	snap := &GraphSnapshot{}
	snap.EnsureMaps()

	score, note := computeConfidence(snap)
	if score != 0 {
		t.Errorf("empty snapshot should have 0 confidence, got %d", score)
	}
	if note != "Graph topology only — no runtime data available" {
		t.Errorf("unexpected note for empty snapshot: %s", note)
	}
}
