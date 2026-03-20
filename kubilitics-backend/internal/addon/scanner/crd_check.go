package scanner

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type CRDChecker struct{}

func (c *CRDChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	gvr := schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}
	crdList, err := input.DynamicClient.Resource(gvr).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list CRDs: %w", err)
	}

	existingOwner := make(map[string]string, len(crdList.Items))
	for i := range crdList.Items {
		name := crdList.Items[i].GetName()
		labels := crdList.Items[i].GetLabels()
		owner := ""
		if labels != nil {
			owner = labels["helm.sh/chart"]
		}
		existingOwner[name] = owner
	}

	checks := make([]models.PreflightCheck, 0, len(input.AddonDetail.CRDsOwned))
	for i := range input.AddonDetail.CRDsOwned {
		crdName := toCRDName(input.AddonDetail.CRDsOwned[i].CRDResource, input.AddonDetail.CRDsOwned[i].CRDGroup)
		if crdName == "" {
			continue
		}
		owner, found := existingOwner[crdName]
		if !found {
			checks = append(checks, models.PreflightCheck{
				Type:   models.CheckCRDConflict,
				Status: models.PreflightGO,
				Title:  "CRD is available for install",
				Detail: fmt.Sprintf("CRD %s does not exist and can be created.", crdName),
			})
			continue
		}

		if owner == "" || !strings.Contains(strings.ToLower(owner), strings.ToLower(input.AddonDetail.HelmChart)) {
			checks = append(checks, models.PreflightCheck{
				Type:       models.CheckCRDConflict,
				Status:     models.PreflightBLOCK,
				Title:      "CRD ownership conflict",
				Detail:     fmt.Sprintf("CRD %s is already owned by %q and conflicts with %s.", crdName, owner, input.AddonDetail.HelmChart),
				Resolution: "Remove conflicting chart or choose a non-conflicting add-on.",
			})
			continue
		}

		checks = append(checks, models.PreflightCheck{
			Type:   models.CheckCRDConflict,
			Status: models.PreflightGO,
			Title:  "CRD already present",
			Detail: fmt.Sprintf("CRD %s exists and appears to be owned by the same chart, upgrade path is safe.", crdName),
		})
	}

	if len(checks) == 0 {
		checks = append(checks, models.PreflightCheck{
			Type:   models.CheckCRDConflict,
			Status: models.PreflightGO,
			Title:  "No CRDs declared by add-on",
			Detail: "This add-on does not declare CRD ownership.",
		})
	}
	return normalizeCheckTypes(checks), nil
}

func toCRDName(resource, group string) string {
	resource = strings.TrimSpace(resource)
	group = strings.TrimSpace(group)
	if resource == "" || group == "" {
		return ""
	}
	return resource + "." + group
}

func normalizeCheckTypes(checks []models.PreflightCheck) []models.PreflightCheck {
	for i := range checks {
		checks[i].Type = models.CheckCRDConflict
	}
	return checks
}
