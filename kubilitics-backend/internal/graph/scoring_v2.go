package graph

import (
	"fmt"
	"math"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// --- Input types ---

type ResilienceInput struct {
	Kind          string
	Replicas      int
	HasHPA        bool
	HasPDB        bool
	HasController bool
}

type ExposureInput struct {
	IsIngressExposed   bool
	ConsumerCount      int
	CrossNsCount       int
	K8sFanIn           int
	TraceDataAvailable bool
	IsCriticalSystem   bool
}

type RecoveryInput struct {
	Kind           string
	Replicas       int
	HasController  bool
	HasPVC         bool
	IsControlPlane bool
}

func computeResilience(in ResilienceInput) models.SubScoreDetail {
	score := 100.0
	var factors []models.ScoringFactor

	switch in.Kind {
	case "Deployment", "StatefulSet":
		penalty := 40.0 * (1.0 / math.Max(float64(in.Replicas)+1.0, 1.0))
		score -= penalty
		factors = append(factors, models.ScoringFactor{
			Name: "replica_count", Value: fmt.Sprintf("%d", in.Replicas),
			Effect: -penalty, Note: fmt.Sprintf("%d replica(s)", in.Replicas),
		})
		if !in.HasHPA {
			score -= 15
			factors = append(factors, models.ScoringFactor{
				Name: "hpa", Value: "absent", Effect: -15, Note: "No autoscaler configured",
			})
		} else {
			factors = append(factors, models.ScoringFactor{
				Name: "hpa", Value: "present", Effect: 0, Note: "Autoscaler configured",
			})
		}
		if !in.HasPDB && in.Replicas > 1 {
			score -= 15
			factors = append(factors, models.ScoringFactor{
				Name: "pdb", Value: "absent", Effect: -15, Note: "No disruption budget",
			})
		} else if in.HasPDB {
			factors = append(factors, models.ScoringFactor{
				Name: "pdb", Value: "present", Effect: 0, Note: "Disruption budget configured",
			})
		}
	case "DaemonSet":
		score = math.Max(score, 70)
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "DaemonSet", Effect: 0,
			Note: fmt.Sprintf("Inherently distributed across %d nodes", in.Replicas),
		})
	case "Pod":
		if !in.HasController {
			score -= 20
			factors = append(factors, models.ScoringFactor{
				Name: "controller", Value: "none", Effect: -20, Note: "Standalone pod — no self-healing",
			})
		}
	case "Service":
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "Service", Effect: 0, Note: "Resilience from backing workload",
		})
	case "Job", "CronJob":
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: in.Kind, Effect: 0, Note: "Transient workload",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{Score: int(math.Round(score)), Factors: factors}
}

func computeExposure(in ExposureInput) models.SubScoreDetail {
	score := 0.0
	var factors []models.ScoringFactor
	source := "k8s-native"
	confidence := "low"

	if in.IsIngressExposed {
		score += 35
		factors = append(factors, models.ScoringFactor{
			Name: "ingress", Value: "exposed", Effect: 35, Note: "Internet-facing via Ingress",
		})
	}
	if in.TraceDataAvailable {
		consumerScore := math.Min(float64(in.ConsumerCount)*8, 30)
		score += consumerScore
		factors = append(factors, models.ScoringFactor{
			Name: "consumers", Value: fmt.Sprintf("%d", in.ConsumerCount),
			Effect: consumerScore, Note: fmt.Sprintf("%d service(s) call this (from traces)", in.ConsumerCount),
		})
		source = "otel"
		confidence = "high"
	} else {
		fanInScore := math.Min(float64(in.K8sFanIn)*5, 20)
		score += fanInScore
		factors = append(factors, models.ScoringFactor{
			Name: "fan_in", Value: fmt.Sprintf("%d", in.K8sFanIn),
			Effect: fanInScore, Note: fmt.Sprintf("%d K8s-level dependent(s)", in.K8sFanIn),
		})
	}
	if in.CrossNsCount > 1 {
		crossNsScore := math.Min(float64(in.CrossNsCount)*5, 15)
		score += crossNsScore
		factors = append(factors, models.ScoringFactor{
			Name: "cross_namespace", Value: fmt.Sprintf("%d", in.CrossNsCount),
			Effect: crossNsScore, Note: fmt.Sprintf("%d namespace(s) depend on this", in.CrossNsCount),
		})
	}
	if in.IsCriticalSystem {
		score = math.Max(score, 80)
		factors = append(factors, models.ScoringFactor{
			Name: "critical_system", Value: "true", Effect: 0, Note: "Critical system component — floor applied",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{Score: int(math.Round(score)), Factors: factors, Source: source, Confidence: confidence}
}

func computeRecovery(in RecoveryInput) models.SubScoreDetail {
	score := 100.0
	var factors []models.ScoringFactor

	if in.Kind == "Pod" && !in.HasController {
		score -= 50
		factors = append(factors, models.ScoringFactor{
			Name: "controller", Value: "none", Effect: -50, Note: "Manual intervention required",
		})
	}
	if in.Kind == "StatefulSet" {
		score -= 20
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "StatefulSet", Effect: -20, Note: "Ordered restart, data reattachment",
		})
	}
	if in.Kind == "DaemonSet" {
		score -= 5
		factors = append(factors, models.ScoringFactor{
			Name: "kind", Value: "DaemonSet", Effect: -5, Note: "Node-scoped recovery",
		})
	}
	headroomPenalty := 20.0 * (1.0 / math.Max(float64(in.Replicas)+1.0, 1.0))
	score -= headroomPenalty
	factors = append(factors, models.ScoringFactor{
		Name: "headroom", Value: fmt.Sprintf("%d replicas", in.Replicas),
		Effect: -headroomPenalty, Note: fmt.Sprintf("Recovery headroom with %d replica(s)", in.Replicas),
	})
	if in.HasPVC {
		score -= 10
		factors = append(factors, models.ScoringFactor{
			Name: "pvc", Value: "attached", Effect: -10, Note: "Data volume reattachment delay",
		})
	}
	if in.IsControlPlane {
		score -= 30
		factors = append(factors, models.ScoringFactor{
			Name: "control_plane", Value: "true", Effect: -30, Note: "Control plane — may require manual recovery",
		})
	}

	score = math.Max(math.Min(score, 100), 0)
	return models.SubScoreDetail{Score: int(math.Round(score)), Factors: factors}
}

func computeOverallCriticality(scores models.SubScores) float64 {
	resilience := float64(scores.Resilience.Score)
	exposure := float64(scores.Exposure.Score)
	recovery := float64(scores.Recovery.Score)
	impact := float64(scores.Impact.Score)

	failureDimension := math.Max((100-resilience)*0.25, impact*0.30)
	rest := exposure*0.30 + (100-recovery)*0.15
	criticality := failureDimension + rest
	weightSum := 0.30 + 0.30 + 0.15 // exposure + max(resilience,impact) + recovery
	if weightSum > 0 {
		criticality = criticality / weightSum
	}
	return math.Round(math.Min(math.Max(criticality, 0), 100)*100) / 100
}

func criticalityLevelV2(score float64) string {
	switch {
	case score > 70:
		return "critical"
	case score >= 45:
		return "high"
	case score >= 20:
		return "medium"
	default:
		return "low"
	}
}
