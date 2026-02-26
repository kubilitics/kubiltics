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
		fmt.Fprintf(stderr, "     → run: %skcli why pod/%s%s\n", ansiCyan, h.PodName, ansiReset)
	}
	fmt.Fprintf(stderr, "%s%s%s\n", ansiGray, sep, ansiReset)
}

// stdoutIsTTY returns true when os.Stdout is connected to an interactive terminal.
func stdoutIsTTY() bool {
	return term.IsTerminal(int(os.Stdout.Fd()))
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

			// P1-5: Crash hint annotation — eligible when:
			//   1. request targets pods with default table output
			//   2. stdout is an interactive TTY (not piped)
			//   3. KCLI_HINTS env var is not set to "0"
			if isCrashHintEligible(clean) &&
				stdoutIsTTY() &&
				strings.TrimSpace(os.Getenv("KCLI_HINTS")) != "0" {
				// Capture kubectl output so we can parse it for problem statuses.
				tableOut, runErr := a.captureKubectl(append([]string{"get"}, clean...))
				// Always print the captured output to stdout first.
				if tableOut != "" {
					fmt.Print(tableOut)
					if !strings.HasSuffix(tableOut, "\n") {
						fmt.Println()
					}
				}
				if runErr == nil {
					// Parse and print hints to stderr (does not affect stdout / scripts).
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
