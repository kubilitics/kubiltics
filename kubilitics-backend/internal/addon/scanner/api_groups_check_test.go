package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery/fake"
	k8sfake "k8s.io/client-go/kubernetes/fake"
)

func TestAPIGroupChecker_Run(t *testing.T) {
	ctx := context.Background()
	checker := &APIGroupChecker{}

	// Create a fake Discovery Client with some API groups
	clientset := k8sfake.NewSimpleClientset()
	fakeDiscovery, ok := clientset.Discovery().(*fake.FakeDiscovery)
	assert.True(t, ok)

	fakeDiscovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
		},
		{
			GroupVersion: "networking.k8s.io/v1",
		},
		{
			GroupVersion: "custom.example.com/v1",
		},
	}

	addonDetail := &models.AddOnDetail{
		RBACRequired: []models.AddOnRBACRule{
			{APIGroups: []string{"apps", "networking.k8s.io"}},
		},
		CRDsOwned: []models.AddOnCRDOwnership{
			{CRDGroup: "custom.example.com"},
		},
	}

	// Case 1: All groups exist, and one CRD group is already registered
	inputOK := CheckInput{
		DiscoveryClient: clientset.Discovery(),
		AddonDetail:     addonDetail,
	}

	res, err := checker.Run(ctx, inputOK)
	assert.NoError(t, err)
	// We expect a warning for the existing CRD group
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "CRD group already registered")

	// Case 2: Missing API group
	addonMissing := &models.AddOnDetail{
		RBACRequired: []models.AddOnRBACRule{
			{APIGroups: []string{"apps", "missing.example.com"}},
		},
	}
	inputMissing := CheckInput{
		DiscoveryClient: clientset.Discovery(),
		AddonDetail:     addonMissing,
	}

	res, err = checker.Run(ctx, inputMissing)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightBLOCK, res[0].Status)
	assert.Contains(t, res[0].Title, "Missing API groups")
	assert.Contains(t, res[0].Detail, "missing.example.com")

	// Case 3: Error during discovery (we simulate this by providing a nil client which will panic or fail depending on how it's used, but setting up a fail reactor is cleaner. However simpleclientset discovery is hard to mock failures on. We will skip for now as it's a basic system error).
}
