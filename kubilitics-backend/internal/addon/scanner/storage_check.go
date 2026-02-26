package scanner

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	defaultStorageClassAnnotation     = "storageclass.kubernetes.io/is-default-class"
	betaDefaultStorageClassAnnotation = "storageclass.beta.kubernetes.io/is-default-class"
)

type StorageChecker struct{}

func (c *StorageChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	cost := selectDevCostModel(input.AddonDetail.CostModels)
	if cost == nil || cost.StorageGB <= 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckStorageClass,
			Status: models.PreflightGO,
			Title:  "No persistent storage requirement",
			Detail: "Add-on baseline does not require a persistent volume for the selected profile.",
		}}, nil
	}

	storageClasses, err := input.K8sClient.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		if apierrors.IsForbidden(err) {
			return []models.PreflightCheck{{
				Type:       models.CheckStorageClass,
				Status:     models.PreflightWARN,
				Title:      "StorageClass access denied",
				Detail:     "Insufficient permissions to list StorageClasses; verify a default StorageClass exists or set storageClassName explicitly in values.",
				Resolution: "Grant list permission on storageclasses.storage.k8s.io or provide explicit chart storage class values.",
			}}, nil
		}
		return nil, fmt.Errorf("list storage classes: %w", err)
	}

	for i := range storageClasses.Items {
		annotations := storageClasses.Items[i].GetAnnotations()
		if annotations[defaultStorageClassAnnotation] == "true" || annotations[betaDefaultStorageClassAnnotation] == "true" {
			return []models.PreflightCheck{{
				Type:   models.CheckStorageClass,
				Status: models.PreflightGO,
				Title:  "Default StorageClass available",
				Detail: fmt.Sprintf("Default StorageClass %q will be used for requested persistent storage.", storageClasses.Items[i].Name),
			}}, nil
		}
	}

	return []models.PreflightCheck{{
		Type:       models.CheckStorageClass,
		Status:     models.PreflightWARN,
		Title:      "No default StorageClass",
		Detail:     "No default StorageClass found; add-on volumes may remain Pending unless storageClassName is configured.",
		Resolution: "Set storageClassName in Helm values or mark an existing StorageClass as default.",
	}}, nil
}
