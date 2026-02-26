package advisor

import (
	"context"
	"log/slog"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Advisor struct {
	repo   repository.AddOnRepository
	logger *slog.Logger
}

func NewAdvisor(repo repository.AddOnRepository, logger *slog.Logger) *Advisor {
	if logger == nil {
		logger = slog.Default()
	}
	return &Advisor{
		repo:   repo,
		logger: logger,
	}
}

func (a *Advisor) GetRecommendations(ctx context.Context, clusterID string, client *k8s.Client) ([]models.AdvisorRecommendation, error) {
	if client == nil {
		return nil, nil
	}

	installed, _ := a.repo.ListClusterInstalls(ctx, clusterID)
	installedMap := make(map[string]bool)
	for _, inst := range installed {
		installedMap[inst.AddonID] = true
	}

	var recs []models.AdvisorRecommendation

	// 1. Ingress Check
	ingresses, _ := client.Clientset.NetworkingV1().Ingresses("").List(ctx, metav1.ListOptions{})
	hasIngressResources := len(ingresses.Items) > 0

	hasIngressController := installedMap["ingress-nginx"]

	if hasIngressResources && !hasIngressController {
		recs = append(recs, models.AdvisorRecommendation{
			AddonID:     "ingress-nginx",
			Reason:      "Ingress resources detected, but no supported ingress controller found.",
			Priority:    "high",
			Description: "Install Ingress NGINX to handle external traffic for your cluster.",
		})
	}

	// 2. TLS Check
	hasTLS := false
	for _, ing := range ingresses.Items {
		if len(ing.Spec.TLS) > 0 {
			hasTLS = true
			break
		}
	}
	if hasTLS && !installedMap["cert-manager"] {
		recs = append(recs, models.AdvisorRecommendation{
			AddonID:     "cert-manager",
			Reason:      "TLS-enabled Ingresses detected without cert-manager.",
			Priority:    "high",
			Description: "Install cert-manager to automatically provision and rotate SSL/TLS certificates.",
		})
	}

	// 3. Observability Check
	pods, _ := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if len(pods.Items) > 15 && !installedMap["kube-prometheus-stack"] {
		recs = append(recs, models.AdvisorRecommendation{
			AddonID:     "kube-prometheus-stack",
			Reason:      "Significant workload detected without centralized monitoring.",
			Priority:    "medium",
			Description: "Install the Prometheus stack for deep observability and alerting.",
		})
	}

	// 4. Security Check
	if !installedMap["kyverno"] {
		recs = append(recs, models.AdvisorRecommendation{
			AddonID:     "kyverno",
			Reason:      "No security policy engine detected.",
			Priority:    "low",
			Description: "Install Kyverno to enforce security best practices across your cluster.",
		})
	}

	// 5. Cost Visibility
	if !installedMap["opencost"] {
		recs = append(recs, models.AdvisorRecommendation{
			AddonID:     "opencost",
			Reason:      "Cost visibility is not enabled.",
			Priority:    "medium",
			Description: "Install OpenCost to track and optimize your Kubernetes spending.",
		})
	}

	return recs, nil
}
