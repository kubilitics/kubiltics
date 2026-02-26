package cli

// ---------------------------------------------------------------------------
// P3-6: Surface missing kubectl delete flags in help/completion
//
// The delete command is high-stakes: --cascade, --grace-period, --force, and
// --dry-run are critical flags that users need to know about.  This file
// replaces the generic newKubectlVerbCmd passthrough with a documented
// first-class command whose --help output lists all important flags.
//
// All flags still pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newDeleteCmd returns a first-class 'delete' command with comprehensive
// help text surfacing all important deletion flags.
func newDeleteCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "delete (TYPE/NAME | -f FILENAME | -l SELECTOR) [flags]",
		Short: "Delete resources by name, file, or label selector",
		Long: `Delete resources by file, resource name, or label selector.

⚠  This operation is irreversible.  Always prefer --dry-run=server first.

Important flags (all pass through to kubectl):

  -f, --filename=[]           Files, directories, or URLs identifying resources
  -k, --kustomize=DIR         Kustomize directory
  -R, --recursive             Recurse into sub-directories for -f
  -l, --selector=SELECTOR     Label selector (e.g. app=nginx)
  -A, --all-namespaces        Delete across all namespaces
      --all                   Delete all resources of the given type

  --dry-run=none|client|server  Preview without deleting
      client  — validate locally; no server contact
      server  — server validates; shows what WOULD be deleted

  --cascade=background|foreground|orphan
                              Cascading deletion strategy (default: background)
      background  — delete owner first, dependents garbage-collected (default)
      foreground  — delete dependents first, then owner (blocking)
      orphan      — delete owner only; leave dependents running

  --grace-period=SECONDS      Override the resource's terminationGracePeriodSeconds
                              Use 0 with --force to skip the grace period entirely
  --force                     Immediately remove the resource from the API
                              (combines with --grace-period=0 for pods)
  --wait                      Wait for resource deletion to complete (default: true)
  --timeout=DURATION          Maximum wait time (e.g. 30s, 5m)

  -o, --output=FORMAT         Output format after deletion (yaml, json, name, ...)
  --ignore-not-found          Treat "not found" as success (useful in CI/CD)

Examples:

  # Delete a specific resource
  kcli delete deployment/api

  # Dry-run first (server-side — validates auth and resource existence)
  kcli delete deployment/api --dry-run=server

  # Delete all pods with a label selector
  kcli delete pod -l app=nginx

  # Immediate forced deletion (e.g. for stuck pods)
  kcli delete pod/stuck-pod --force --grace-period=0

  # Delete from a manifest file, orphaning dependents
  kcli delete -f deployment.yaml --cascade=orphan

  # Delete across all namespaces
  kcli delete pod -l app=nginx -A --ignore-not-found`,
		GroupID:            "core",
		DisableFlagParsing: true,
		ValidArgsFunction:  a.completeKubectl("delete"),
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"delete"}, clean...))
		},
	}
}
