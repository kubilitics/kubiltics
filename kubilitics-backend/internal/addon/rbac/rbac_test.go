package rbac

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	authv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	testingk8s "k8s.io/client-go/testing"
)

func TestPermissionChecker_CheckClusterAdmin(t *testing.T) {
	ctx := context.Background()
	clientset := fake.NewSimpleClientset()

	// Mock Allowed=true
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, &authv1.SelfSubjectAccessReview{
			Status: authv1.SubjectAccessReviewStatus{Allowed: true},
		}, nil
	})

	checker := NewPermissionChecker(clientset)
	allowed, err := checker.CheckClusterAdmin(ctx)
	assert.NoError(t, err)
	assert.True(t, allowed)
}

func TestPermissionChecker_CheckPermissions(t *testing.T) {
	ctx := context.Background()
	clientset := fake.NewSimpleClientset()

	// Mock Allowed=false for everything
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, &authv1.SelfSubjectAccessReview{
			Status: authv1.SubjectAccessReviewStatus{Allowed: false},
		}, nil
	})

	checker := NewPermissionChecker(clientset)
	rules := []models.AddOnRBACRule{
		{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get", "list"},
			Scope:     "namespace",
		},
	}

	gaps, err := checker.CheckPermissions(ctx, rules, "default")
	assert.NoError(t, err)
	assert.Len(t, gaps, 2)

	countGet := 0
	countList := 0
	for _, g := range gaps {
		if g.Verb == "get" {
			countGet++
		}
		if g.Verb == "list" {
			countList++
		}
	}
	assert.Equal(t, 1, countGet)
	assert.Equal(t, 1, countList)
}

func TestGenerateMinimalRBAC(t *testing.T) {
	addon := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{Name: "test-addon"},
		RBACRequired: []models.AddOnRBACRule{
			{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"get"},
				Scope:     "namespace",
			},
			{
				APIGroups: []string{""},
				Resources: []string{"nodes"},
				Verbs:     []string{"list"},
				Scope:     "cluster",
			},
		},
	}

	cr, binding, err := GenerateMinimalRBAC(addon, "test-rel", "test-ns")
	assert.NoError(t, err)
	assert.Contains(t, cr, "ClusterRole")
	assert.Contains(t, cr, "nodes")
	assert.Contains(t, binding, "Role")
	assert.Contains(t, binding, "pods")

	// Missing addon
	cr, binding, err = GenerateMinimalRBAC(nil, "test-rel", "test-ns")
	assert.Error(t, err)
	assert.Equal(t, "", cr)
	assert.Equal(t, "", binding)

	// Missing releaseName
	cr, binding, err = GenerateMinimalRBAC(addon, "", "test-ns")
	assert.Error(t, err)

	// Missing namespace
	cr, binding, err = GenerateMinimalRBAC(addon, "test-rel", "")
	assert.Error(t, err)

	// Only Namespace scope
	addonOnlyNs := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{Name: "test-ns-only"},
		RBACRequired: []models.AddOnRBACRule{
			{
				APIGroups: []string{""},
				Resources: []string{"configmaps"},
				Verbs:     []string{"get"},
				Scope:     "namespace",
			},
		},
	}
	cr, binding, err = GenerateMinimalRBAC(addonOnlyNs, "test-rel", "test-ns")
	assert.NoError(t, err)
	assert.Equal(t, "", cr) // No cluster role
	assert.Contains(t, binding, "Role")
	assert.Contains(t, binding, "configmaps")
}

func TestPermissionChecker_CheckClusterAdmin_Error(t *testing.T) {
	ctx := context.Background()
	clientset := fake.NewSimpleClientset()

	// Mock error
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, assert.AnError
	})

	checker := NewPermissionChecker(clientset)
	allowed, err := checker.CheckClusterAdmin(ctx)
	assert.Error(t, err)
	assert.False(t, allowed)
}

func TestPermissionChecker_CheckPermissions_Error(t *testing.T) {
	ctx := context.Background()
	clientset := fake.NewSimpleClientset()

	// Mock error
	clientset.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, assert.AnError
	})

	checker := NewPermissionChecker(clientset)
	rules := []models.AddOnRBACRule{
		{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get"},
			Scope:     "namespace",
		},
	}

	gaps, err := checker.CheckPermissions(ctx, rules, "default")
	assert.Error(t, err)
	assert.Nil(t, gaps)
}

func TestDeterminePermissionLevel(t *testing.T) {
	ctx := context.Background()

	// Case 1: Full
	clientsetFull := fake.NewSimpleClientset()
	clientsetFull.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, &authv1.SelfSubjectAccessReview{
			Status: authv1.SubjectAccessReviewStatus{Allowed: true},
		}, nil
	})
	lvl, err := DeterminePermissionLevel(ctx, clientsetFull, "cluster-1")
	assert.NoError(t, err)
	assert.Equal(t, LevelFull, lvl)

	// Case 2: Namespace
	clientsetNs := fake.NewSimpleClientset()
	clientsetNs.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		sar := action.(testingk8s.CreateAction).GetObject().(*authv1.SelfSubjectAccessReview)
		if sar.Spec.ResourceAttributes.Verb == "*" {
			return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: false}}, nil
		}
		if sar.Spec.ResourceAttributes.Resource == "deployments" {
			return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: true}}, nil
		}
		return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: false}}, nil
	})
	lvl, err = DeterminePermissionLevel(ctx, clientsetNs, "cluster-1")
	assert.NoError(t, err)
	assert.Equal(t, LevelNamespace, lvl)

	// Case 3: View
	clientsetView := fake.NewSimpleClientset()
	clientsetView.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		sar := action.(testingk8s.CreateAction).GetObject().(*authv1.SelfSubjectAccessReview)
		if sar.Spec.ResourceAttributes.Resource == "pods" && sar.Spec.ResourceAttributes.Verb == "get" {
			return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: true}}, nil
		}
		return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: false}}, nil
	})
	lvl, err = DeterminePermissionLevel(ctx, clientsetView, "cluster-1")
	assert.NoError(t, err)
	assert.Equal(t, LevelView, lvl)

	// Case 4: None
	clientsetNone := fake.NewSimpleClientset()
	clientsetNone.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, &authv1.SelfSubjectAccessReview{Status: authv1.SubjectAccessReviewStatus{Allowed: false}}, nil
	})
	lvl, err = DeterminePermissionLevel(ctx, clientsetNone, "cluster-1")
	assert.NoError(t, err)
	assert.Equal(t, LevelNone, lvl)

	// Case 5: Error
	clientsetErr := fake.NewSimpleClientset()
	clientsetErr.PrependReactor("create", "selfsubjectaccessreviews", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, assert.AnError
	})
	lvl, err = DeterminePermissionLevel(ctx, clientsetErr, "cluster-1")
	assert.Error(t, err)
	assert.Equal(t, LevelNone, lvl)
}

func TestGenerateManifestYAML(t *testing.T) {
	// Empty rules
	yamlStr, err := GenerateManifestYAML(nil, "default", "test-addon")
	assert.NoError(t, err)
	assert.Contains(t, yamlStr, "No RBAC rules defined")

	rules := []models.AddOnRBACRule{
		{
			APIGroups: []string{""},
			Resources: []string{"pods"},
			Verbs:     []string{"get", "list"},
			Scope:     "namespace",
		},
		{
			APIGroups: []string{"apps"},
			Resources: []string{"deployments"},
			Verbs:     []string{"create"},
			Scope:     "cluster",
		},
	}

	yamlStr, err = GenerateManifestYAML(rules, "test-ns", "test/addon")
	assert.NoError(t, err)
	// Output should contain ClusterRole, ClusterRoleBinding, Role, RoleBinding
	assert.Contains(t, yamlStr, "kind: ClusterRole")
	assert.Contains(t, yamlStr, "kind: ClusterRoleBinding")
	assert.Contains(t, yamlStr, "kind: Role")
	assert.Contains(t, yamlStr, "kind: RoleBinding")
	assert.Contains(t, yamlStr, "test-addon-role")
	assert.Contains(t, yamlStr, "namespace: test-ns")

	rules[0].APIGroups = nil
	rules[0].Resources = nil
	yamlStr, err = GenerateManifestYAML(rules, "", "")
	assert.NoError(t, err)
	assert.Contains(t, yamlStr, "namespace: default")
}
