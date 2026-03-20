package scanner

import (
	"context"
	"fmt"
	"strings"

	addonrbac "github.com/kubilitics/kubilitics-backend/internal/addon/rbac"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	authv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type RBACChecker struct{}

func (c *RBACChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	checks, _, _, err := c.RunWithArtifacts(ctx, input)
	return checks, err
}

func (c *RBACChecker) RunWithArtifacts(ctx context.Context, input CheckInput) ([]models.PreflightCheck, *models.RBACDiff, []models.ResourceEstimate, error) {
	gaps := make([]models.PermissionGap, 0)

	for i := range input.AddonDetail.RBACRequired {
		rule := input.AddonDetail.RBACRequired[i]
		namespace := ""
		if rule.Scope == string(models.ScopeNamespace) {
			namespace = input.TargetNamespace
		}
		for _, apiGroup := range rule.APIGroups {
			for _, resource := range rule.Resources {
				for _, verb := range rule.Verbs {
					sar := &authv1.SelfSubjectAccessReview{
						Spec: authv1.SelfSubjectAccessReviewSpec{
							ResourceAttributes: &authv1.ResourceAttributes{
								Namespace: namespace,
								Verb:      verb,
								Group:     apiGroup,
								Resource:  resource,
							},
						},
					}
					resp, err := input.K8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
					if err != nil {
						return nil, nil, nil, fmt.Errorf("create self subject access review for %s/%s %s: %w", apiGroup, resource, verb, err)
					}
					if !resp.Status.Allowed {
						gaps = append(gaps, models.PermissionGap{
							APIGroup:  apiGroup,
							Resource:  resource,
							Verb:      verb,
							Scope:     rule.Scope,
							Namespace: namespace,
						})
					}
				}
			}
		}
	}

	if len(gaps) == 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckRBAC,
			Status: models.PreflightGO,
			Title:  "RBAC permissions sufficient",
			Detail: "All required Kubernetes permissions are available for this add-on.",
		}}, nil, nil, nil
	}

	clusterRoleYAML, bindingYAML, err := addonrbac.GenerateMinimalRBAC(input.AddonDetail, input.AddonDetail.Name, input.TargetNamespace)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("generate minimal rbac for addon %s: %w", input.AddonDetail.ID, err)
	}
	diff := &models.RBACDiff{
		Missing:                  gaps,
		GeneratedClusterRoleYAML: clusterRoleYAML,
		GeneratedBindingYAML:     bindingYAML,
	}
	missingMessages := make([]string, 0, len(gaps))
	for i := range gaps {
		missingMessages = append(missingMessages, fmt.Sprintf("%s/%s verb=%s scope=%s", gaps[i].APIGroup, gaps[i].Resource, gaps[i].Verb, gaps[i].Scope))
	}
	check := models.PreflightCheck{
		Type:       models.CheckRBAC,
		Status:     models.PreflightBLOCK,
		Title:      "Missing RBAC permissions",
		Detail:     "Missing permissions: " + strings.Join(missingMessages, "; "),
		Resolution: "Apply generated RBAC manifest and rerun pre-flight checks.",
	}
	return []models.PreflightCheck{check}, diff, nil, nil
}
