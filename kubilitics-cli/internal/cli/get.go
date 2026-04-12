package cli

// ---------------------------------------------------------------------------
// P3-6 (partial): Surface missing kubectl get flags in help/completion
//
// 'get' is the most frequently run kubectl command.  This file replaces
// the generic passthrough with a documented command that surfaces:
//   --watch / -w                  watch for changes
//   --output-watch-events         include watch event types in watch output
//   --show-managed-fields         show SSA field ownership metadata
//   --subresource=STATUS|SCALE    get a subresource directly
//   --chunk-size=N                server-side pagination (important for large clusters)
//
// P1-5: Crash hint annotation.
//   When `kcli get pods` is run in an interactive terminal (not piped), and the
//   output table contains pods with problem statuses (CrashLoopBackOff, OOMKilled,
//   Error, Pending, ImagePullBackOff, Evicted), a concise hint block is appended
//   to stderr. This does not affect stdout so scripts and pipes are unaffected.
//
//   Suppressed by:
//     - Any non-default output format (-o yaml, -o json, -o jsonpath, etc.)
//     - Non-interactive output (stdout is not a TTY / is piped)
//     - KCLI_HINTS=0 environment variable
//
// Multi-cluster support (existing kcli feature) is preserved.
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/spf13/cobra"
	"k8s.io/client-go/tools/clientcmd"

	kubectlpkg "github.com/kubilitics/kubilitics/kubilitics-cli/internal/kubectl"
)

// crashHintEntry holds one pod that needs attention.
type crashHintEntry struct {
	PodName string
	Status  string
}

// podProblemStatuses is the set of status strings that warrant a crash hint.
// These match what appears in the STATUS column of `kubectl get pods` output.
var podProblemStatuses = []string{
	"CrashLoopBackOff",
	"OOMKilled",
	"Error",
	"ImagePullBackOff",
	"ErrImagePull",
	"Evicted",
	"Pending",
	"Terminating",
	"CreateContainerConfigError",
	"InvalidImageName",
}

// isCrashHintEligible returns true when the args target pods with default table
// output — i.e. we should consider appending crash hints.
//
// Returns false when:
//   - resource type is not pods/pod/po
//   - -o / --output / -w / --watch / --all-contexts flags are present with
//     non-table formats
//   - -o wide is OK (still a table)
func isCrashHintEligible(args []string) bool {
	hasPods := false
	for i, a := range args {
		a = strings.TrimSpace(a)
		// Resource type detection: plain "pods", "pod", "po", or "pods/name" etc.
		if !strings.HasPrefix(a, "-") {
			lower := strings.ToLower(a)
			if lower == "pods" || lower == "pod" || lower == "po" ||
				strings.HasPrefix(lower, "pods/") || strings.HasPrefix(lower, "pod/") ||
				strings.HasPrefix(lower, "po/") {
				hasPods = true
			}
			continue
		}
		// -o / --output flag: table (default) and wide are OK; everything else is not.
		if a == "-o" || a == "--output" {
			if i+1 < len(args) {
				fmt := strings.TrimSpace(args[i+1])
				if fmt != "wide" && fmt != "table" {
					return false
				}
			}
			continue
		}
		if strings.HasPrefix(a, "--output=") {
			fmt := strings.TrimSpace(strings.TrimPrefix(a, "--output="))
			if fmt != "wide" && fmt != "table" {
				return false
			}
			continue
		}
		if strings.HasPrefix(a, "-o=") {
			fmt := strings.TrimSpace(strings.TrimPrefix(a, "-o="))
			if fmt != "wide" && fmt != "table" {
				return false
			}
			continue
		}
		// -w / --watch: kubectl streams live output; hints would interleave badly.
		if a == "-w" || a == "--watch" || a == "--output-watch-events" {
			return false
		}
	}
	return hasPods
}

// parsePodCrashHints parses the plain-text table output of `kubectl get pods`
// and returns entries for pods whose STATUS column contains a problem value.
//
// The kubectl table format is:
//
//	NAME                         READY   STATUS            RESTARTS   AGE
//	api-7f9d                     1/1     Running           0          2d
//	worker-crash-5f8b7           0/1     CrashLoopBackOff  12         5m
//
// We find the STATUS column index from the header line and then parse each
// subsequent line accordingly.
func parsePodCrashHints(tableOutput string) []crashHintEntry {
	lines := strings.Split(strings.TrimSpace(tableOutput), "\n")
	if len(lines) < 2 {
		return nil
	}

	// Find the header line (first non-empty line starting with NAME).
	headerIdx := -1
	statusColStart := -1
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "NAME") {
			headerIdx = i
			// Find the byte offset of the STATUS column in the header.
			upper := strings.ToUpper(line)
			idx := strings.Index(upper, "STATUS")
			if idx >= 0 {
				statusColStart = idx
			}
			break
		}
	}
	if headerIdx < 0 || statusColStart < 0 {
		return nil
	}

	var hints []crashHintEntry
	seen := map[string]bool{}
	for _, line := range lines[headerIdx+1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		// Extract pod name (first whitespace-delimited field).
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		podName := fields[0]

		// Extract STATUS: field index 2 is always STATUS in kubectl get pods output:
		//   NAME(0)  READY(1)  STATUS(2)  RESTARTS(3)  AGE(4)
		// We prefer field-index over column-offset because pod names vary in length
		// and the column offset in the header does not always align with data rows.
		status := ""
		if len(fields) >= 3 {
			status = fields[2]
		} else if statusColStart >= 0 && statusColStart < len(line) {
			// Very short line fallback — use column offset.
			rest := strings.TrimSpace(line[statusColStart:])
			if parts := strings.Fields(rest); len(parts) > 0 {
				status = parts[0]
			}
		}

		if status == "" || seen[podName] {
			continue
		}

		for _, prob := range podProblemStatuses {
			if strings.EqualFold(status, prob) {
				seen[podName] = true
				hints = append(hints, crashHintEntry{PodName: podName, Status: status})
				break
			}
		}
	}
	return hints
}

// printCrashHints writes the crash hint block to stderr.
func printCrashHints(hints []crashHintEntry, stderr *os.File) {
	if len(hints) == 0 {
		return
	}
	sep := strings.Repeat("─", 65)
	fmt.Fprintf(stderr, "\n%s%s%s\n", ansiGray, sep, ansiReset)
	fmt.Fprintf(stderr, "%s%sℹ  %d pod(s) need attention:%s\n", ansiBold, ansiYellow, len(hints), ansiReset)
	for _, h := range hints {
		fmt.Fprintf(stderr, "   %s•%s %-40s %s(%s)%s\n", ansiBold, ansiReset, h.PodName, ansiRed, h.Status, ansiReset)
		fmt.Fprintf(stderr, "     → run: %skcli status pod/%s%s\n", ansiCyan, h.PodName, ansiReset)
	}
	fmt.Fprintf(stderr, "%s%s%s\n", ansiGray, sep, ansiReset)
}

// stdoutIsTTY returns true when os.Stdout is connected to an interactive terminal.
func stdoutIsTTY() bool {
	return term.IsTerminal(int(os.Stdout.Fd()))
}

// hasWithModifier detects if args contain the "with" keyword for enhanced output.
// Example: ["pods", "with", "ip,node"] → true
func hasWithModifier(args []string) bool {
	for _, arg := range args {
		if strings.EqualFold(arg, "with") {
			return true
		}
	}
	return false
}

// enhanceableResources is the set of resource types that kcli can render with
// beautiful colored tables via client-go (instead of plain kubectl passthrough).
var enhanceableResources = map[string]bool{
	// Core workloads
	"pod": true, "pods": true, "po": true,
	"deployment": true, "deployments": true, "deploy": true,
	"statefulset": true, "statefulsets": true, "sts": true,
	"daemonset": true, "daemonsets": true, "ds": true,
	"replicaset": true, "replicasets": true, "rs": true,
	"job": true, "jobs": true,
	"cronjob": true, "cronjobs": true, "cj": true,
	// Networking
	"service": true, "services": true, "svc": true,
	"ingress": true, "ingresses": true, "ing": true,
	"endpoints": true, "ep": true,
	"networkpolicy": true, "networkpolicies": true, "netpol": true,
	// Config & storage
	"configmap": true, "configmaps": true, "cm": true,
	"secret": true, "secrets": true,
	"persistentvolume": true, "persistentvolumes": true, "pv": true,
	"persistentvolumeclaim": true, "persistentvolumeclaims": true, "pvc": true,
	"storageclass": true, "storageclasses": true, "sc": true,
	// RBAC
	"serviceaccount": true, "serviceaccounts": true, "sa": true,
	"role": true, "roles": true,
	"rolebinding": true, "rolebindings": true,
	"clusterrole": true, "clusterroles": true,
	"clusterrolebinding": true, "clusterrolebindings": true,
	// Cluster
	"namespace": true, "namespaces": true, "ns": true,
	"node": true, "nodes": true,
	"event": true, "events": true, "ev": true,
	// Policy & quotas
	"horizontalpodautoscaler": true, "horizontalpodautoscalers": true, "hpa": true,
	"limitrange": true, "limitranges": true,
	"resourcequota": true, "resourcequotas": true,
}

// shouldUseEnhancedGet returns true when args represent a simple resource list
// that kcli can render beautifully (TTY, enhanceable resource, default table output,
// no watch, no specific resource name like pods/my-pod).
func shouldUseEnhancedGet(args []string) bool {
	if !stdoutIsTTY() {
		return false // piped output → use kubectl for script compatibility
	}
	if strings.TrimSpace(os.Getenv("KCLI_PLAIN")) == "1" {
		return false // user explicitly wants kubectl passthrough
	}

	resourceFound := ""
	hasSpecificName := false
	for i, a := range args {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		// Skip flags and their values
		if a == "-o" || a == "--output" {
			if i+1 < len(args) {
				outFmt := strings.TrimSpace(args[i+1])
				// Only enhance for default table output, not json/yaml/jsonpath/wide etc.
				if outFmt != "" && outFmt != "table" {
					return false
				}
			}
			continue
		}
		if strings.HasPrefix(a, "--output=") || strings.HasPrefix(a, "-o=") || strings.HasPrefix(a, "-o") {
			val := strings.TrimPrefix(strings.TrimPrefix(a, "--output="), "-o=")
			if len(a) == 2 { // -o without = (value is next arg)
				continue
			}
			if val == "" { // -owide, -ojson etc
				val = a[2:]
			}
			if val != "" && val != "table" {
				return false
			}
			continue
		}
		if a == "-w" || a == "--watch" || a == "--output-watch-events" {
			return false
		}
		if strings.HasPrefix(a, "-") {
			// skip other flags and their values
			if (a == "-l" || a == "--selector" || a == "-n" || a == "--namespace" ||
				a == "--field-selector" || a == "--sort-by" || a == "--chunk-size") && i+1 < len(args) {
				// these flags consume the next arg
			}
			continue
		}
		// Non-flag positional arg
		if resourceFound == "" {
			resourceFound = strings.ToLower(a)
		} else {
			// Second positional = specific resource name (e.g. "pods my-pod")
			hasSpecificName = true
		}
		// Check for type/name format (e.g. "pods/my-pod")
		if strings.Contains(a, "/") {
			hasSpecificName = true
		}
	}

	if hasSpecificName {
		return false // specific resource → kubectl describe-like output is better
	}
	return enhanceableResources[resourceFound]
}

// runEnhancedGet handles "kcli get <resource> with <modifiers>" by routing to
// the kubectl enhancer engine which uses client-go for rich output.
func (a *app) runEnhancedGet(args []string) error {
	// Parse "with" modifiers from args — prepend "get" since Cobra already consumed it
	_, resource, modifiers, remainingArgs, err := kubectlpkg.ParseWithModifiers(append([]string{"get"}, args...))
	if err != nil {
		return err
	}

	// Extract flags from remaining args
	namespace := a.namespace
	allNamespaces := false
	sortBy := ""
	outputFormat := ""
	kubeconfigPath := a.kubeconfig

	for i := 0; i < len(remainingArgs); i++ {
		arg := remainingArgs[i]
		switch {
		case arg == "-A" || arg == "--all-namespaces":
			allNamespaces = true
		case arg == "-n" || arg == "--namespace":
			if i+1 < len(remainingArgs) {
				i++
				namespace = remainingArgs[i]
			}
		case strings.HasPrefix(arg, "-n="):
			namespace = strings.TrimPrefix(arg, "-n=")
		case strings.HasPrefix(arg, "--namespace="):
			namespace = strings.TrimPrefix(arg, "--namespace=")
		case strings.HasPrefix(arg, "--sort-by="):
			sortBy = strings.TrimPrefix(arg, "--sort-by=")
		case arg == "-o" || arg == "--output":
			if i+1 < len(remainingArgs) {
				i++
				outputFormat = remainingArgs[i]
			}
		case strings.HasPrefix(arg, "-o="):
			outputFormat = strings.TrimPrefix(arg, "-o=")
		case strings.HasPrefix(arg, "--output="):
			outputFormat = strings.TrimPrefix(arg, "--output=")
		case strings.HasPrefix(arg, "--kubeconfig="):
			kubeconfigPath = strings.TrimPrefix(arg, "--kubeconfig=")
		}
	}

	if kubeconfigPath == "" {
		kubeconfigPath = os.Getenv("KUBECONFIG")
		if kubeconfigPath == "" {
			home, _ := os.UserHomeDir()
			kubeconfigPath = home + "/.kube/config"
		}
	}

	// CRITICAL: When no namespace is specified and -A is not set, resolve the
	// default namespace from kubeconfig (just like kubectl does). An empty
	// namespace string passed to client-go means "all namespaces" which is WRONG
	// for the default case — users expect current-namespace behavior.
	if namespace == "" && !allNamespaces {
		namespace = resolveCurrentNamespace(kubeconfigPath, a.context)
	}

	return kubectlpkg.EnhancedGet(kubeconfigPath, a.context, namespace, resource, modifiers, allNamespaces, sortBy, outputFormat)
}

// runInteractiveAfterGet extracts resource type and namespace from args,
// queries resource names via kubectl, and enters interactive selection mode.
func (a *app) runInteractiveAfterGet(args []string) error {
	// Extract resource type and namespace from args
	resourceType := ""
	namespace := a.namespace
	allNS := false
	for i, arg := range args {
		arg = strings.TrimSpace(arg)
		if arg == "-A" || arg == "--all-namespaces" {
			allNS = true
			continue
		}
		if (arg == "-n" || arg == "--namespace") && i+1 < len(args) {
			namespace = args[i+1]
			continue
		}
		if strings.HasPrefix(arg, "-") {
			continue
		}
		if resourceType == "" {
			resourceType = arg
		}
	}

	if resourceType == "" {
		return nil
	}

	// Resolve namespace
	kubeconfigPath := a.kubeconfig
	if kubeconfigPath == "" {
		kubeconfigPath = os.Getenv("KUBECONFIG")
		if kubeconfigPath == "" {
			home, _ := os.UserHomeDir()
			kubeconfigPath = home + "/.kube/config"
		}
	}
	if namespace == "" && !allNS {
		namespace = resolveCurrentNamespace(kubeconfigPath, a.context)
	}

	// Query resource names via kubectl
	queryArgs := []string{"get", resourceType, "-o", `jsonpath={range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}`}
	if allNS {
		queryArgs = append(queryArgs, "-A")
	} else if namespace != "" {
		queryArgs = append(queryArgs, "-n", namespace)
	}

	out, err := a.captureKubectl(queryArgs)
	if err != nil {
		return fmt.Errorf("interactive: failed to query resources: %w", err)
	}

	var names, namespaces []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "\t", 2)
		if len(parts) == 2 && parts[1] != "" {
			namespaces = append(namespaces, parts[0])
			names = append(names, parts[1])
		} else if len(parts) == 1 && parts[0] != "" {
			names = append(names, parts[0])
			namespaces = append(namespaces, namespace)
		}
	}

	if len(names) == 0 {
		return nil
	}

	return a.interactiveResourceSelect(resourceType, names, namespaces)
}

// resolveCurrentNamespace reads the kubeconfig to determine the namespace
// configured for the current (or overridden) context. Returns "default" if
// no namespace is set in the kubeconfig context.
func resolveCurrentNamespace(kubeconfigPath, contextOverride string) string {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if contextOverride != "" {
		configOverrides.CurrentContext = contextOverride
	}
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
	ns, _, err := clientConfig.Namespace()
	if err != nil || ns == "" {
		return "default"
	}
	return ns
}

// newGetCmd returns a first-class 'get' command with comprehensive help text.
func newGetCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "get (TYPE | TYPE/NAME | TYPE NAME1 NAME2) [flags]",
		Short:   "Get one or many resources",
		Aliases: []string{"g"},
		Long: `Display one or many resources.

Important flags (all pass through to kubectl):

  -f, --filename=[]                Files identifying the resource to get
  -l, --selector=SELECTOR          Label selector (e.g. app=nginx)
  -A, --all-namespaces             List across all namespaces

  -o, --output=FORMAT              Output format:
      wide         — extra columns (node name, IP, etc.)
      yaml         — full YAML manifest
      json         — full JSON manifest
      name         — resource/name pairs only
      jsonpath=EXPR — JSONPath expression (e.g. '{.status.phase}')
      custom-columns=SPEC — custom column definitions
      go-template=TEMPLATE — Go template output

  -w, --watch                      Watch for resource changes in real time
  --output-watch-events            Include ADDED/MODIFIED/DELETED event types
                                   in watch output (use with --watch)
  --show-managed-fields            Show field manager metadata (useful for
                                   debugging SSA conflicts)
  --subresource=STATUS|SCALE       Get a subresource instead of the main resource
  --chunk-size=N                   Server-side pagination chunk size
                                   (default 500; set to 0 to disable)
  --sort-by=JSONPATH               Sort list output by a JSONPath expression
  --show-labels                    Add a LABELS column to the output
  --ignore-not-found               Return exit code 0 even if not found
  --field-selector=SELECTOR        Server-side field filter (e.g. status.phase=Running)

kcli-specific flags:

  -i, --interactive              After listing, enter interactive mode:
                                 select a resource by # and perform actions
                                 (logs, describe, exec, edit, delete, etc.)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Get all pods in the current namespace
  kcli get pods

  # Get a specific deployment in YAML
  kcli get deployment/api -o yaml

  # Watch pod status changes
  kcli get pods --watch

  # Watch with event types (ADDED/MODIFIED/DELETED)
  kcli get pods --watch --output-watch-events

  # Get pods across all namespaces with node info
  kcli get pods -A -o wide

  # Get just running pods via field selector
  kcli get pods --field-selector=status.phase=Running

  # Show SSA field ownership metadata
  kcli get deployment/api -o yaml --show-managed-fields

  # Get the scale subresource
  kcli get deployment/api --subresource=scale -o json

  # Interactive mode — select a resource and perform actions
  kcli get pods -i                   # table + action menu (logs, describe, exec...)
  kcli get deployments -i            # scale, restart, edit...
  kcli get nodes -i                  # cordon, drain, describe...

  # Multi-cluster get (kcli feature)
  kcli get pods --context=prod-east --context=prod-west`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Check for -i / --interactive flag
			interactive := false
			var cleanNoI []string
			for _, arg := range clean {
				if arg == "-i" || arg == "--interactive" {
					interactive = true
				} else {
					cleanNoI = append(cleanNoI, arg)
				}
			}
			if interactive {
				clean = cleanNoI
			}

			// "with" modifier support: kcli get pods with ip,node
			if hasWithModifier(clean) {
				if err := a.runEnhancedGet(clean); err != nil {
					return err
				}
				if interactive {
					return a.runInteractiveAfterGet(clean)
				}
				return nil
			}

			// Enhanced table output: when the user runs a simple list command
			// on a TTY (e.g. "kcli get pods", "kcli get deployments -A"),
			// route through the enhanced engine for colored tables with
			// status icons, responsive columns, and presentation-ready output.
			// -i flag forces enhanced mode (needs table for interactive selection).
			if interactive || shouldUseEnhancedGet(clean) {
				if err := a.runEnhancedGet(clean); err != nil {
					return err
				}
				if interactive {
					return a.runInteractiveAfterGet(clean)
				}
				return nil
			}

			// P1-5: Crash hint annotation for kubectl passthrough path.
			// When output goes through kubectl (piped, -o wide, etc.) and
			// targets pods, append hints for problem statuses.
			if isCrashHintEligible(clean) &&
				stdoutIsTTY() &&
				strings.TrimSpace(os.Getenv("KCLI_HINTS")) != "0" {
				tableOut, runErr := a.captureKubectl(append([]string{"get"}, clean...))
				if tableOut != "" {
					fmt.Print(tableOut)
					if !strings.HasSuffix(tableOut, "\n") {
						fmt.Println()
					}
				}
				if runErr == nil {
					hints := parsePodCrashHints(tableOut)
					if len(hints) > 0 {
						printCrashHints(hints, os.Stderr)
					}
				}
				return runErr
			}

			return a.runGetWithMultiCluster(clean)
		},
	}
}
