package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
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
	if detail.Score > 45 {
		t.Errorf("expected resilience <= 45 for single replica no HPA/PDB, got %d", detail.Score)
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
