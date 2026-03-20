package rbac

import (
	"context"

	authv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// PermissionLevel indicates how much the current subject can do in the cluster.
type PermissionLevel string

const (
	LevelFull      PermissionLevel = "full"      // cluster-admin equivalent
	LevelNamespace PermissionLevel = "namespace"  // can create deployments etc.
	LevelView      PermissionLevel = "view"      // can get pods (read-only)
	LevelNone      PermissionLevel = "none"
)

// DeterminePermissionLevel runs SelfSubjectAccessReviews to infer the highest level.
// Used at cluster registration to decide which Kubilitics features are available.
func DeterminePermissionLevel(ctx context.Context, k8sClient kubernetes.Interface, clusterID string) (PermissionLevel, error) {
	_ = clusterID
	// Cluster-admin: *, *, *
	sar := &authv1.SelfSubjectAccessReview{
		Spec: authv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authv1.ResourceAttributes{
				Verb:     "*",
				Group:    "*",
				Resource: "*",
			},
		},
	}
	resp, err := k8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		return LevelNone, err
	}
	if resp.Status.Allowed {
		return LevelFull, nil
	}
	// Create deployments (apps, deployments, create)
	sar.Spec.ResourceAttributes = &authv1.ResourceAttributes{
		Verb:     "create",
		Group:    "apps",
		Resource: "deployments",
	}
	resp, err = k8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		return LevelNone, err
	}
	if resp.Status.Allowed {
		return LevelNamespace, nil
	}
	// Get pods (core, pods, get)
	sar.Spec.ResourceAttributes = &authv1.ResourceAttributes{
		Verb:     "get",
		Group:    "",
		Resource: "pods",
	}
	resp, err = k8sClient.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		return LevelNone, err
	}
	if resp.Status.Allowed {
		return LevelView, nil
	}
	return LevelNone, nil
}
