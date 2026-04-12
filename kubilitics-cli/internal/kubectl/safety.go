package kubectl

import (
	"fmt"
	"os"
	"strings"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

// RiskLevel represents the danger level of an operation
type RiskLevel int

const (
	RiskNone     RiskLevel = iota
	RiskLow
	RiskMedium
	RiskHigh
	RiskCritical
)

// ClassifyRisk determines the risk level of a kubectl command based on verb and args.
func ClassifyRisk(args []string) RiskLevel {
	if len(args) == 0 {
		return RiskNone
	}

	verb := strings.ToLower(args[0])

	if verb == "get" || verb == "describe" || verb == "logs" || verb == "explain" ||
		verb == "api-resources" || verb == "auth" || verb == "top" || verb == "version" ||
		verb == "config" || verb == "cluster-info" {
		return RiskNone
	}

	if verb == "apply" || verb == "patch" {
		return RiskMedium
	}

	if verb == "annotate" || verb == "label" {
		return RiskMedium
	}

	if verb == "rollout" && len(args) > 1 && args[1] == "restart" {
		return RiskMedium
	}

	if verb == "rollout" && len(args) > 1 && args[1] == "undo" {
		return RiskHigh
	}

	if verb == "edit" {
		return RiskMedium
	}

	if verb == "scale" {
		return classifyScaleRisk(args)
	}

	if verb == "delete" {
		return classifyDeleteRisk(args)
	}

	if verb == "drain" || verb == "cordon" || verb == "uncordon" {
		if verb == "drain" {
			return RiskCritical
		}
		return RiskHigh
	}

	if verb == "taint" {
		return RiskHigh
	}

	if verb == "replace" || verb == "create" {
		return RiskMedium
	}

	return RiskNone
}

func classifyScaleRisk(args []string) RiskLevel {
	for i, arg := range args {
		if arg == "--replicas" && i+1 < len(args) {
			replicas := args[i+1]
			if replicas == "0" {
				return RiskCritical
			}
			return RiskLow
		}
	}
	return RiskLow
}

func classifyDeleteRisk(args []string) RiskLevel {
	if len(args) < 2 {
		return RiskCritical
	}

	for _, arg := range args {
		if arg == "--all" {
			return RiskCritical
		}
	}

	hasBroadSelector := false
	for i, arg := range args {
		if (arg == "-l" || arg == "--selector") && i+1 < len(args) {
			hasBroadSelector = true
			break
		}
	}

	resourceSpec := strings.ToLower(args[1])
	parts := strings.Split(resourceSpec, "/")
	resource := parts[0]

	if resource == "namespace" || resource == "ns" {
		return RiskCritical
	}

	if (resource == "pod" || resource == "pods" || resource == "po") && (len(parts) < 2 || hasBroadSelector) {
		return RiskCritical
	}

	if resource == "job" || resource == "jobs" {
		if len(parts) < 2 || hasBroadSelector {
			return RiskCritical
		}
		return RiskHigh
	}

	if resource == "deployment" || resource == "deployments" || resource == "deploy" ||
		resource == "statefulset" || resource == "statefulsets" || resource == "sts" ||
		resource == "daemonset" || resource == "daemonsets" || resource == "ds" {
		return RiskCritical
	}

	if resource == "service" || resource == "services" || resource == "svc" {
		return RiskCritical
	}

	if resource == "persistentvolumeclaim" || resource == "pvc" {
		return RiskHigh
	}

	if resource == "configmap" || resource == "configmaps" ||
		resource == "secret" || resource == "secrets" {
		return RiskMedium
	}

	if (resource == "pod" || resource == "pods" || resource == "po") && len(parts) >= 2 {
		return RiskHigh
	}

	return RiskHigh
}

// CheckSafety shows appropriate confirmation prompts based on risk level.
// Returns true if the user confirms or --yes/KCLI_CONFIRM is set.
func CheckSafety(args []string, context, namespace string, forceYes bool) (bool, error) {
	for _, arg := range args {
		if arg == "--yes" {
			forceYes = true
		}
	}

	riskLevel := ClassifyRisk(args)

	if riskLevel == RiskNone {
		return true, nil
	}

	statInfo, _ := os.Stdin.Stat()
	isInteractive := (statInfo.Mode() & os.ModeCharDevice) != 0

	if !isInteractive && !forceYes {
		return false, fmt.Errorf("operation requires confirmation; set --yes or run in interactive mode")
	}

	if forceYes {
		return true, nil
	}

	verb := strings.ToLower(args[0])
	resourceSpec := ""
	if len(args) > 1 {
		resourceSpec = args[1]
	}

	switch riskLevel {
	case RiskLow, RiskMedium:
		return promptSimple(verb, resourceSpec, context, namespace), nil
	case RiskHigh:
		return promptDetailed(verb, resourceSpec, context, namespace), nil
	case RiskCritical:
		return promptCritical(verb, resourceSpec, context, namespace), nil
	}

	return true, nil
}

func promptSimple(verb, resource, context, namespace string) bool {
	msg := fmt.Sprintf("Continue with %s %s?", verb, resource)
	confirmed, _ := output.ConfirmYesNo(msg, map[string]string{
		"Context":   context,
		"Namespace": namespace,
	})
	return confirmed
}

func promptDetailed(verb, resource, context, namespace string) bool {
	confirmed, _ := output.ConfirmYesNo(fmt.Sprintf("⚠ %s %s", strings.ToUpper(verb), resource), map[string]string{
		"Action":    strings.ToUpper(verb),
		"Resource":  resource,
		"Context":   context,
		"Namespace": namespace,
	})
	return confirmed
}

func promptCritical(verb, resource, context, namespace string) bool {
	confirmed, _ := output.ConfirmCritical(
		fmt.Sprintf("CRITICAL: %s %s", strings.ToUpper(verb), resource),
		map[string]string{
			"Action":    strings.ToUpper(verb),
			"Resource":  resource,
			"Context":   context,
			"Namespace": namespace,
		},
		"yes",
	)
	return confirmed
}
