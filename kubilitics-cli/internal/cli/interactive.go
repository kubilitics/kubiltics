package cli

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

// resourceAction defines an action that can be performed on a resource.
type resourceAction struct {
	Key         string // single char or short key
	Label       string // display label
	Description string // what it does
	NeedsExec   bool   // requires exec into container (pods only)
}

// actionsForResource returns the available actions based on resource type.
func actionsForResource(resourceType string) []resourceAction {
	switch strings.ToLower(resourceType) {
	case "pod", "pods", "po":
		return []resourceAction{
			{Key: "l", Label: "Logs", Description: "Stream logs"},
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "x", Label: "Exec", Description: "Execute shell in container"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "p", Label: "Port-forward", Description: "Forward a port"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "deployment", "deployments", "deploy":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "l", Label: "Logs", Description: "Stream logs (all pods)"},
			{Key: "s", Label: "Scale", Description: "Scale replicas"},
			{Key: "r", Label: "Restart", Description: "Rolling restart"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "service", "services", "svc":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "p", Label: "Port-forward", Description: "Forward a port"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "node", "nodes":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "c", Label: "Cordon", Description: "Mark unschedulable"},
			{Key: "u", Label: "Uncordon", Description: "Mark schedulable"},
			{Key: "dr", Label: "Drain", Description: "Drain node for maintenance"},
		}
	case "namespace", "namespaces", "ns":
		return []resourceAction{
			{Key: "sw", Label: "Switch", Description: "Switch to this namespace"},
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "del", Label: "Delete", Description: "Delete namespace"},
		}
	case "configmap", "configmaps", "cm":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "secret", "secrets":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "statefulset", "statefulsets", "sts":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "l", Label: "Logs", Description: "Stream logs (all pods)"},
			{Key: "s", Label: "Scale", Description: "Scale replicas"},
			{Key: "r", Label: "Restart", Description: "Rolling restart"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "daemonset", "daemonsets", "ds":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "l", Label: "Logs", Description: "Stream logs (all pods)"},
			{Key: "r", Label: "Restart", Description: "Rolling restart"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "job", "jobs":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "l", Label: "Logs", Description: "Stream job logs"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete job"},
		}
	case "cronjob", "cronjobs", "cj":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "su", Label: "Suspend", Description: "Suspend cronjob"},
			{Key: "re", Label: "Resume", Description: "Resume cronjob"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "ingress", "ingresses", "ing":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "persistentvolumeclaim", "persistentvolumeclaims", "pvc":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit (expand storage)"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete PVC"},
		}
	case "persistentvolume", "persistentvolumes", "pv":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "horizontalpodautoscaler", "horizontalpodautoscalers", "hpa":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit HPA targets"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete HPA"},
		}
	case "event", "events", "ev":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show event details"},
		}
	case "replicaset", "replicasets", "rs":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "s", Label: "Scale", Description: "Scale replicas"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "serviceaccount", "serviceaccounts", "sa":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	case "endpoints", "ep":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "networkpolicy", "networkpolicies", "netpol":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit policy"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete policy"},
		}
	case "role", "roles":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete role"},
		}
	case "rolebinding", "rolebindings":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete binding"},
		}
	case "clusterrole", "clusterroles":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "clusterrolebinding", "clusterrolebindings":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "storageclass", "storageclasses", "sc":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "limitrange", "limitranges":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	case "resourcequota", "resourcequotas":
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit quota"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
		}
	default:
		return []resourceAction{
			{Key: "d", Label: "Describe", Description: "Show detailed info"},
			{Key: "e", Label: "Edit", Description: "Edit resource"},
			{Key: "y", Label: "YAML", Description: "Show YAML manifest"},
			{Key: "del", Label: "Delete", Description: "Delete resource"},
		}
	}
}

// interactiveResourceSelect shows the action menu after a table is displayed.
// rows contains the table data where nameIdx and nsIdx are the column indices
// for NAME and NAMESPACE.
func (a *app) interactiveResourceSelect(resourceType string, names []string, namespaces []string) error {
	if len(names) == 0 {
		return nil
	}

	theme := output.GetTheme()
	reader := bufio.NewReader(os.Stdin)

	for {
		// Prompt for resource selection
		fmt.Fprintf(os.Stderr, "\n%s", theme.Primary.Render(
			fmt.Sprintf("Select resource [1-%d] (q=quit): ", len(names))))

		input, err := reader.ReadString('\n')
		if err != nil {
			return nil
		}
		input = strings.TrimSpace(strings.ToLower(input))

		if input == "q" || input == "quit" || input == "" {
			return nil
		}

		idx, err := strconv.Atoi(input)
		if err != nil || idx < 1 || idx > len(names) {
			fmt.Fprintf(os.Stderr, "%s\n", theme.Error.Render(
				fmt.Sprintf("  Invalid selection. Enter 1-%d or q to quit.", len(names))))
			continue
		}

		selectedName := names[idx-1]
		selectedNS := ""
		if idx-1 < len(namespaces) {
			selectedNS = namespaces[idx-1]
		}

		// Show action menu
		if err := a.showActionMenu(reader, resourceType, selectedName, selectedNS); err != nil {
			fmt.Fprintf(os.Stderr, "%s\n", theme.Error.Render(fmt.Sprintf("  Error: %v", err)))
		}
	}
}

func (a *app) showActionMenu(reader *bufio.Reader, resourceType, name, namespace string) error {
	theme := output.GetTheme()
	actions := actionsForResource(resourceType)

	for {
		// Display selected resource header
		fmt.Fprintf(os.Stderr, "\n  %s %s\n",
			theme.Header.Render(fmt.Sprintf(" %s ", name)),
			theme.Muted.Render(fmt.Sprintf("(%s)", namespace)))

		// Display action options
		fmt.Fprintf(os.Stderr, "  ")
		for i, act := range actions {
			key := theme.Primary.Bold(true).Render(fmt.Sprintf("[%s]", strings.ToUpper(act.Key)))
			label := act.Label
			fmt.Fprintf(os.Stderr, "%s %s", key, label)
			if i < len(actions)-1 {
				fmt.Fprintf(os.Stderr, "  ")
			}
		}
		fmt.Fprintf(os.Stderr, "  %s\n", theme.Muted.Render("[Q] Back to list"))

		// Read action
		fmt.Fprintf(os.Stderr, "\n  %s", theme.Primary.Render("Action: "))
		input, err := reader.ReadString('\n')
		if err != nil {
			return nil
		}
		input = strings.TrimSpace(strings.ToLower(input))

		if input == "q" || input == "quit" || input == "back" || input == "" {
			return nil // back to resource list
		}

		// Build and execute the kubectl command
		args := a.buildActionArgs(resourceType, name, namespace, input, actions)
		if args == nil {
			fmt.Fprintf(os.Stderr, "  %s\n", theme.Warning.Render("Unknown action. Try again."))
			continue
		}

		fmt.Fprintf(os.Stderr, "\n  %s\n",
			theme.Muted.Render(fmt.Sprintf("→ kcli %s", strings.Join(args, " "))))

		// Show helpful context for exec
		if input == "x" || input == "exec" {
			fmt.Fprintf(os.Stderr, "  %s\n\n",
				theme.Info.Render("Entering container shell... (type 'exit' or Ctrl+D to return)"))
		} else {
			fmt.Fprintln(os.Stderr)
		}

		// Execute the action
		if err := a.runKubectl(args); err != nil {
			// Don't show error for signal termination (Ctrl+C from exec)
			if !strings.Contains(err.Error(), "exit 130") {
				fmt.Fprintf(os.Stderr, "\n  %s\n", theme.Error.Render(fmt.Sprintf("Error: %v", err)))
			}
		}

		// Stay on the SAME resource — loop back to action menu
		fmt.Fprintf(os.Stderr, "\n%s\n",
			theme.Muted.Render("  ─────────────────────────────────────"))
	}
}

func (a *app) buildActionArgs(resourceType, name, namespace, action string, actions []resourceAction) []string {
	nsArgs := []string{}
	if namespace != "" {
		nsArgs = []string{"-n", namespace}
	}

	// Match action key
	var matched *resourceAction
	for i := range actions {
		if strings.EqualFold(actions[i].Key, action) ||
			strings.EqualFold(actions[i].Label, action) ||
			strings.HasPrefix(strings.ToLower(actions[i].Label), action) {
			matched = &actions[i]
			break
		}
	}

	if matched == nil {
		return nil
	}

	resourceRef := fmt.Sprintf("%s/%s", singularResourceType(resourceType), name)

	switch strings.ToLower(matched.Key) {
	case "l":
		args := append([]string{"logs", resourceRef, "--tail=100"}, nsArgs...)
		return args
	case "d":
		return append([]string{"describe", resourceRef}, nsArgs...)
	case "e":
		return append([]string{"edit", resourceRef}, nsArgs...)
	case "x":
		// namespace must come BEFORE "--" (everything after is the container command)
		args := append([]string{"exec", "-it"}, nsArgs...)
		return append(args, name, "--", "sh")
	case "p":
		args := append([]string{"port-forward"}, nsArgs...)
		return append(args, resourceRef, "8080:80")
	case "del":
		return append([]string{"delete", resourceRef}, nsArgs...)
	case "s":
		return append([]string{"scale", resourceRef, "--replicas=3"}, nsArgs...)
	case "r":
		return append([]string{"rollout", "restart", resourceRef}, nsArgs...)
	case "y":
		return append([]string{"get", resourceRef, "-o", "yaml"}, nsArgs...)
	case "c":
		return append([]string{"cordon", name}, nsArgs...)
	case "u":
		return append([]string{"uncordon", name}, nsArgs...)
	case "dr":
		return append([]string{"drain", name, "--ignore-daemonsets", "--delete-emptydir-data"}, nsArgs...)
	case "sw":
		return []string{"config", "set-context", "--current", "--namespace", name}
	case "su":
		return append([]string{"patch", resourceRef, "-p", `{"spec":{"suspend":true}}`}, nsArgs...)
	case "re":
		return append([]string{"patch", resourceRef, "-p", `{"spec":{"suspend":false}}`}, nsArgs...)
	default:
		return nil
	}
}

func singularResourceType(resourceType string) string {
	rt := strings.ToLower(resourceType)
	switch rt {
	case "pods", "po":
		return "pod"
	case "deployments", "deploy":
		return "deployment"
	case "services", "svc":
		return "service"
	case "statefulsets", "sts":
		return "statefulset"
	case "daemonsets", "ds":
		return "daemonset"
	case "configmaps", "cm":
		return "configmap"
	case "secrets":
		return "secret"
	case "nodes":
		return "node"
	case "namespaces", "ns":
		return "namespace"
	case "ingresses", "ing":
		return "ingress"
	case "jobs":
		return "job"
	case "cronjobs", "cj":
		return "cronjob"
	case "serviceaccounts", "sa":
		return "serviceaccount"
	case "replicasets", "rs":
		return "replicaset"
	case "endpoints", "ep":
		return "endpoints" // endpoints is already singular in k8s
	case "horizontalpodautoscalers", "hpa":
		return "horizontalpodautoscaler"
	case "networkpolicies", "netpol":
		return "networkpolicy"
	case "roles":
		return "role"
	case "rolebindings":
		return "rolebinding"
	case "clusterroles":
		return "clusterrole"
	case "clusterrolebindings":
		return "clusterrolebinding"
	case "storageclasses", "sc":
		return "storageclass"
	case "persistentvolumeclaims", "pvc":
		return "persistentvolumeclaim"
	case "persistentvolumes", "pv":
		return "persistentvolume"
	case "events", "ev":
		return "event"
	case "limitranges":
		return "limitrange"
	case "resourcequotas":
		return "resourcequota"
	default:
		return strings.TrimSuffix(rt, "s")
	}
}
