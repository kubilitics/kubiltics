package scanner

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

type APIGroupChecker struct{}

func (c *APIGroupChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	groups, err := input.DiscoveryClient.ServerGroups()
	if err != nil {
		return nil, fmt.Errorf("discover server groups: %w", err)
	}
	knownGroups := map[string]struct{}{"": {}}
	for i := range groups.Groups {
		knownGroups[groups.Groups[i].Name] = struct{}{}
	}

	missing := make(map[string]struct{})
	for i := range input.AddonDetail.RBACRequired {
		for _, apiGroup := range input.AddonDetail.RBACRequired[i].APIGroups {
			groupName := strings.TrimSpace(apiGroup)
			if groupName == "" {
				continue
			}
			if _, ok := knownGroups[groupName]; !ok {
				missing[groupName] = struct{}{}
			}
		}
	}

	if len(missing) > 0 {
		items := make([]string, 0, len(missing))
		for group := range missing {
			items = append(items, group)
		}
		return []models.PreflightCheck{{
			Type:       models.CheckAPIGroups,
			Status:     models.PreflightBLOCK,
			Title:      "Missing API groups",
			Detail:     "Cluster does not expose required API groups: " + strings.Join(items, ", "),
			Resolution: "Upgrade cluster or install required APIs/CRDs for missing groups.",
		}}, nil
	}

	warnings := []models.PreflightCheck{}
	for i := range input.AddonDetail.CRDsOwned {
		group := strings.TrimSpace(input.AddonDetail.CRDsOwned[i].CRDGroup)
		if group == "" {
			continue
		}
		if _, ok := knownGroups[group]; ok {
			warnings = append(warnings, models.PreflightCheck{
				Type:   models.CheckAPIGroups,
				Status: models.PreflightWARN,
				Title:  "CRD group already registered",
				Detail: fmt.Sprintf("CRD group %s already exists in cluster; ownership should be validated.", group),
			})
		}
	}

	if len(warnings) > 0 {
		return warnings, nil
	}
	return []models.PreflightCheck{{
		Type:   models.CheckAPIGroups,
		Status: models.PreflightGO,
		Title:  "API groups available",
		Detail: "All required API groups are available in the cluster.",
	}}, nil
}
