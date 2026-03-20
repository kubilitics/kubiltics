package scanner

import (
	"context"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	networkingv1 "k8s.io/api/networking/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

type NetworkPolicyChecker struct{}

func (c *NetworkPolicyChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	namespace := normalizeNamespace(input.TargetNamespace)
	policies, err := input.K8sClient.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		if apierrors.IsForbidden(err) {
			return []models.PreflightCheck{{
				Type:       models.CheckNetworkPolicy,
				Status:     models.PreflightWARN,
				Title:      "NetworkPolicy inspection denied",
				Detail:     fmt.Sprintf("Unable to inspect NetworkPolicies in namespace %q due to RBAC restrictions.", namespace),
				Resolution: "Grant read access to networkpolicies.networking.k8s.io or manually verify add-on traffic policy.",
			}}, nil
		}
		return nil, fmt.Errorf("list network policies in %s: %w", namespace, err)
	}

	if len(policies.Items) == 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckNetworkPolicy,
			Status: models.PreflightGO,
			Title:  "No NetworkPolicies in target namespace",
			Detail: "No NetworkPolicies found; no policy-based traffic restriction detected for add-on workload.",
		}}, nil
	}

	warnings := make([]string, 0, len(policies.Items))
	for i := range policies.Items {
		if !policyMayMatchAddon(policies.Items[i], input.AddonDetail.HelmChart, input.AddonDetail.Name) {
			continue
		}
		if isRestrictivePolicy(policies.Items[i]) {
			warnings = append(warnings, fmt.Sprintf("NetworkPolicy %q may restrict ingress/egress for add-on chart %q.", policies.Items[i].Name, input.AddonDetail.HelmChart))
		}
	}

	if len(warnings) == 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckNetworkPolicy,
			Status: models.PreflightGO,
			Title:  "NetworkPolicies evaluated",
			Detail: "No restrictive NetworkPolicy patterns detected for add-on workload selectors.",
		}}, nil
	}

	return []models.PreflightCheck{{
		Type:       models.CheckNetworkPolicy,
		Status:     models.PreflightWARN,
		Title:      "Restrictive NetworkPolicy detected",
		Detail:     joinMessages(warnings),
		Resolution: "Review ingress/egress rules for matched policies before installation.",
	}}, nil
}

func policyMayMatchAddon(policy networkingv1.NetworkPolicy, chartName, addonName string) bool {
	if policy.Spec.PodSelector.Size() == 0 {
		return true
	}
	selector, err := metav1.LabelSelectorAsSelector(&policy.Spec.PodSelector)
	if err != nil {
		return false
	}
	set := labels.Set{
		"app.kubernetes.io/name": chartName,
		"app":                    addonName,
	}
	return selector.Matches(set)
}

func isRestrictivePolicy(policy networkingv1.NetworkPolicy) bool {
	hasIngressType := false
	hasEgressType := false
	for _, policyType := range policy.Spec.PolicyTypes {
		if policyType == networkingv1.PolicyTypeIngress {
			hasIngressType = true
		}
		if policyType == networkingv1.PolicyTypeEgress {
			hasEgressType = true
		}
	}
	if !hasIngressType && !hasEgressType {
		return false
	}
	if hasIngressType && len(policy.Spec.Ingress) == 0 {
		return true
	}
	if hasEgressType && len(policy.Spec.Egress) == 0 {
		return true
	}
	return false
}

func joinMessages(messages []string) string {
	return strings.Join(messages, " ")
}
