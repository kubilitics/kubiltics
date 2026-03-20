package rbac

import (
	"context"
	"sync"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	authv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"golang.org/x/sync/errgroup"
	"k8s.io/client-go/kubernetes"
)

const maxConcurrentReviews = 10

// PermissionChecker checks whether the current subject has the required RBAC permissions.
type PermissionChecker struct {
	K8sClient kubernetes.Interface
}

// NewPermissionChecker creates a checker that uses the given Kubernetes client.
func NewPermissionChecker(k8sClient kubernetes.Interface) *PermissionChecker {
	return &PermissionChecker{K8sClient: k8sClient}
}

// CheckPermissions runs SelfSubjectAccessReview for each (apiGroup, resource, verb) from the rules.
// Batches up to 10 concurrent reviews. Returns gaps where Status.Allowed is false.
func (c *PermissionChecker) CheckPermissions(ctx context.Context, rules []models.AddOnRBACRule, namespace string) ([]models.PermissionGap, error) {
	var (
		gaps   []models.PermissionGap
		gapMu  sync.Mutex
		tokens = make(chan struct{}, maxConcurrentReviews)
	)
	for i := 0; i < maxConcurrentReviews; i++ {
		tokens <- struct{}{}
	}
	g, gCtx := errgroup.WithContext(ctx)
	for _, rule := range rules {
		rule := rule
		ns := ""
		if rule.Scope == string(models.ScopeNamespace) {
			ns = namespace
		}
		for _, apiGroup := range rule.APIGroups {
			for _, resource := range rule.Resources {
				for _, verb := range rule.Verbs {
					apiGroup, resource, verb := apiGroup, resource, verb
					g.Go(func() error {
						<-tokens
						defer func() { tokens <- struct{}{} }()
						sar := &authv1.SelfSubjectAccessReview{
							Spec: authv1.SelfSubjectAccessReviewSpec{
								ResourceAttributes: &authv1.ResourceAttributes{
									Namespace: ns,
									Verb:      verb,
									Group:     apiGroup,
									Resource:  resource,
								},
							},
						}
						resp, err := c.K8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(gCtx, sar, metav1.CreateOptions{})
						if err != nil {
							return err
						}
						if !resp.Status.Allowed {
							gapMu.Lock()
							gaps = append(gaps, models.PermissionGap{
								APIGroup:  apiGroup,
								Resource:  resource,
								Verb:      verb,
								Scope:     rule.Scope,
								Namespace: ns,
							})
							gapMu.Unlock()
						}
						return nil
					})
				}
			}
		}
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return gaps, nil
}

// CheckClusterAdmin returns true if the current subject has cluster-admin equivalent (all verbs on all resources).
func (c *PermissionChecker) CheckClusterAdmin(ctx context.Context) (bool, error) {
	sar := &authv1.SelfSubjectAccessReview{
		Spec: authv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authv1.ResourceAttributes{
				Verb:     "*",
				Group:    "*",
				Resource: "*",
			},
		},
	}
	resp, err := c.K8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		return false, err
	}
	return resp.Status.Allowed, nil
}
