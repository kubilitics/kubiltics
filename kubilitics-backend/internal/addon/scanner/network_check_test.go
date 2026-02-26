package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	testingk8s "k8s.io/client-go/testing"
)

func TestNetworkPolicyChecker_Run(t *testing.T) {
	ctx := context.Background()
	addon := &models.AddOnDetail{
		AddOnEntry: models.AddOnEntry{Name: "test-addon", HelmChart: "mychart"},
	}

	// Case 1: Forbidden
	clientsetForbidden := fake.NewSimpleClientset()
	clientsetForbidden.PrependReactor("list", "networkpolicies", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, errors.NewForbidden(action.GetResource().GroupResource(), "", nil)
	})
	checker := &NetworkPolicyChecker{}
	inputForbidden := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetForbidden,
		TargetNamespace: "default",
	}
	res, err := checker.Run(ctx, inputForbidden)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "denied")

	// Case 2: List error
	clientsetErr := fake.NewSimpleClientset()
	clientsetErr.PrependReactor("list", "networkpolicies", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, assert.AnError
	})
	inputErr := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetErr,
		TargetNamespace: "default",
	}
	res, err = checker.Run(ctx, inputErr)
	assert.Error(t, err)

	// Case 3: No policies
	clientsetEmpty := fake.NewSimpleClientset()
	inputEmpty := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetEmpty,
		TargetNamespace: "default",
	}
	res, err = checker.Run(ctx, inputEmpty)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)

	// Case 4: Non-matching policy
	clientsetNonMatching := fake.NewSimpleClientset(&networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "non-matching", Namespace: "default"},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "other"},
			},
		},
	})
	inputNonMatching := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetNonMatching,
		TargetNamespace: "default",
	}
	res, err = checker.Run(ctx, inputNonMatching)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)

	// Case 5: Matching, non-restrictive policy
	clientsetMatchingOK := fake.NewSimpleClientset(&networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "matching-ok", Namespace: "default"},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "test-addon"},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeIngress},
			Ingress: []networkingv1.NetworkPolicyIngressRule{
				{}, // Has a rule, so not totally restrictive
			},
		},
	})
	inputMatchingOK := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetMatchingOK,
		TargetNamespace: "default",
	}
	res, err = checker.Run(ctx, inputMatchingOK)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)

	// Case 6: Matching, restrictive policy
	clientsetRestrictive := fake.NewSimpleClientset(&networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "restrictive", Namespace: "default"},
		Spec: networkingv1.NetworkPolicySpec{
			PodSelector: metav1.LabelSelector{
				MatchLabels: map[string]string{"app.kubernetes.io/name": "mychart"},
			},
			PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
			Egress:      []networkingv1.NetworkPolicyEgressRule{}, // Empty means deny all
		},
	})
	inputRestrictive := CheckInput{
		AddonDetail:     addon,
		K8sClient:       clientsetRestrictive,
		TargetNamespace: "default",
	}
	res, err = checker.Run(ctx, inputRestrictive)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "Restrictive")
}
