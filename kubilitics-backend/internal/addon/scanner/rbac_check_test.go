package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	authv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func TestRBACCheckerRunAllowed(t *testing.T) {
	client := fake.NewSimpleClientset()
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action ktesting.Action) (bool, runtime.Object, error) {
		return true, &authv1.SelfSubjectAccessReview{
			Status: authv1.SubjectAccessReviewStatus{Allowed: true},
		}, nil
	})

	checker := &RBACChecker{}
	input := CheckInput{
		K8sClient:       client,
		TargetNamespace: "default",
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "a", Name: "a"},
			RBACRequired: []models.AddOnRBACRule{{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"get"},
				Scope:     string(models.ScopeNamespace),
			}},
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(checks) != 1 || checks[0].Status != models.PreflightGO {
		t.Fatalf("expected GO check, got %+v", checks)
	}
}

func TestRBACCheckerRunDenied(t *testing.T) {
	client := fake.NewSimpleClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "default"}})
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action ktesting.Action) (bool, runtime.Object, error) {
		return true, &authv1.SelfSubjectAccessReview{
			Status: authv1.SubjectAccessReviewStatus{Allowed: false},
		}, nil
	})

	checker := &RBACChecker{}
	input := CheckInput{
		K8sClient:       client,
		TargetNamespace: "default",
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{ID: "a", Name: "a"},
			RBACRequired: []models.AddOnRBACRule{{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"create"},
				Scope:     string(models.ScopeNamespace),
			}},
		},
	}

	checks, err := checker.Run(context.Background(), input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(checks) != 1 || checks[0].Status != models.PreflightBLOCK {
		t.Fatalf("expected BLOCK check, got %+v", checks)
	}
}
