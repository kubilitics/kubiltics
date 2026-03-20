package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	testingk8s "k8s.io/client-go/testing"
)

func TestStorageChecker_Run(t *testing.T) {
	ctx := context.Background()

	addonNoStorage := &models.AddOnDetail{
		CostModels: []models.AddOnCostModel{
			{ClusterTier: "dev", StorageGB: 0},
		},
	}
	addonWithStorage := &models.AddOnDetail{
		CostModels: []models.AddOnCostModel{
			{ClusterTier: "dev", StorageGB: 10},
		},
	}

	// Case 1: No storage requirement
	checker := &StorageChecker{}
	input := CheckInput{
		AddonDetail: addonNoStorage,
	}
	res, err := checker.Run(ctx, input)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)

	// Case 2: Forbidden to list storage classes
	clientsetForbidden := fake.NewSimpleClientset()
	clientsetForbidden.PrependReactor("list", "storageclasses", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, errors.NewForbidden(action.GetResource().GroupResource(), "", nil)
	})
	inputForbidden := CheckInput{
		AddonDetail: addonWithStorage,
		K8sClient:   clientsetForbidden,
	}
	res, err = checker.Run(ctx, inputForbidden)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "denied")

	// Case 3: List error (non-forbidden)
	clientsetErr := fake.NewSimpleClientset()
	clientsetErr.PrependReactor("list", "storageclasses", func(action testingk8s.Action) (handled bool, ret runtime.Object, err error) {
		return true, nil, assert.AnError
	})
	inputErr := CheckInput{
		AddonDetail: addonWithStorage,
		K8sClient:   clientsetErr,
	}
	res, err = checker.Run(ctx, inputErr)
	assert.Error(t, err)

	// Case 4: Has default storage class
	clientsetDefault := fake.NewSimpleClientset(&storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name: "default-sc",
			Annotations: map[string]string{
				"storageclass.kubernetes.io/is-default-class": "true",
			},
		},
	})
	inputDefault := CheckInput{
		AddonDetail: addonWithStorage,
		K8sClient:   clientsetDefault,
	}
	res, err = checker.Run(ctx, inputDefault)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)
	assert.Contains(t, res[0].Detail, "default-sc")

	// Case 5: Has default storage class (beta annotation)
	clientsetBetaDefault := fake.NewSimpleClientset(&storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name: "beta-default-sc",
			Annotations: map[string]string{
				"storageclass.beta.kubernetes.io/is-default-class": "true",
			},
		},
	})
	inputBetaDefault := CheckInput{
		AddonDetail: addonWithStorage,
		K8sClient:   clientsetBetaDefault,
	}
	res, err = checker.Run(ctx, inputBetaDefault)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)
	assert.Contains(t, res[0].Detail, "beta-default-sc")

	// Case 6: No default storage class
	clientsetNoDefault := fake.NewSimpleClientset(&storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name: "other-sc",
		},
	})
	inputNoDefault := CheckInput{
		AddonDetail: addonWithStorage,
		K8sClient:   clientsetNoDefault,
	}
	res, err = checker.Run(ctx, inputNoDefault)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Title, "No default StorageClass")
}
