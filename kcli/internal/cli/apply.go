package cli

// ---------------------------------------------------------------------------
// P3-3: Server-Side Apply as First-Class UX
//
// Replaces the generic kubectl passthrough for 'apply' with a first-class
// command that surfaces server-side apply flags prominently, defaults
// --field-manager to "kcli" for kcli-managed resources, and provides
// clear UX for conflict resolution.
//
// All kubectl apply flags still pass through unchanged.  The three new
// first-class flags are intercepted before forwarding:
//
//   --server-side          Use server-side apply (SSA) instead of client-side
//   --field-manager=NAME   Identity for SSA ownership (default: "kcli")
//   --force-conflicts      Overwrite field-manager conflicts during SSA
//
// These flags already exist in kubectl; kcli surfaces them as first-class
// flags with documentation and a helpful default for --field-manager.
// ---------------------------------------------------------------------------

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// newApplyCmd returns a first-class 'apply' command that enhances the
// server-side apply workflow with a documented --field-manager default and
// surfaced --force-conflicts flag.
func newApplyCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "apply [flags]",
		Short:   "Apply configuration to resources (client-side or server-side)",
		Aliases: []string{"ap"},
		Long: `Apply a configuration to resources by filename or stdin.

By default this runs kubectl's client-side apply.  Pass --server-side to
use Server-Side Apply (SSA), which is the recommended approach for GitOps
and controller-driven workflows.

Server-Side Apply flags (kcli first-class):

  --server-side               Use server-side apply (recommended for GitOps)
  --field-manager=NAME        Manager identity for SSA field ownership (default: "kcli")
  --force-conflicts           Force-apply even when another field manager owns fields

Common kubectl apply flags (all pass through to kubectl):

  -f, --filename=[]           Files, directories, or URLs to apply
  -k, --kustomize=DIR         Kustomize directory to apply
  -R, --recursive             Recurse into sub-directories for -f
  --dry-run=none|client|server  Preview changes without applying them
      client  — validate locally only; no server contact
      server  — validate with server; shows what WOULD be applied
  --prune                     Remove resources no longer in the manifest set
  --prune-allowlist=[]        Restrict pruning to these API groups
  --show-managed-fields       Show field manager metadata in output
  --validate=strict|warn|ignore  Schema validation mode (default: warn)
  -o, --output=FORMAT         Output format (yaml, json, wide, name, ...)

Examples:

  # Client-side apply (default)
  kcli apply -f deployment.yaml

  # Dry-run (server-side validation, no changes applied)
  kcli apply -f deployment.yaml --dry-run=server

  # Server-side apply — kcli becomes the field manager
  kcli apply -f deployment.yaml --server-side

  # Server-side apply with a custom field manager (e.g. for a controller)
  kcli apply -f deployment.yaml --server-side --field-manager=my-controller

  # Force-apply over conflicting field ownership
  kcli apply -f deployment.yaml --server-side --force-conflicts

  # Apply all manifests in a directory recursively
  kcli apply -R -f ./manifests/ --server-side

  # Prune resources that are no longer in the manifest set
  kcli apply -f ./manifests/ --prune --server-side`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags (--context, --namespace, --kubeconfig, --yes).
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Inject --field-manager=kcli when --server-side is present and
			// no --field-manager flag was supplied by the user.
			kArgs := injectApplyDefaults(clean)

			return a.runKubectl(append([]string{"apply"}, kArgs...))
		},
	}
}

// ---------------------------------------------------------------------------
// injectApplyDefaults injects --field-manager=kcli when server-side apply is
// requested and no explicit field manager was specified by the user.
//
// This makes 'kcli apply --server-side' own its managed fields under the
// "kcli" manager identity, which enables clean conflict detection later.
// ---------------------------------------------------------------------------

func injectApplyDefaults(args []string) []string {
	serverSide := false
	hasFieldManager := false

	for _, a := range args {
		t := strings.TrimSpace(a)
		if t == "--server-side" || t == "-s" {
			serverSide = true
		}
		if strings.HasPrefix(t, "--field-manager") {
			hasFieldManager = true
		}
	}

	if !serverSide || hasFieldManager {
		return args
	}

	// Inject --field-manager=kcli before the existing args so it comes early.
	out := make([]string, 0, len(args)+1)
	out = append(out, "--field-manager=kcli")
	out = append(out, args...)
	return out
}

// ---------------------------------------------------------------------------
// applyFieldManagerDefault returns the --field-manager value that would be
// injected for a given arg list.  Exported for testing.
// ---------------------------------------------------------------------------

func applyFieldManagerDefault(args []string) string {
	injected := injectApplyDefaults(args)
	for _, a := range injected {
		if strings.HasPrefix(a, "--field-manager=") {
			return strings.TrimPrefix(a, "--field-manager=")
		}
	}
	return ""
}

// printApplyHelp writes a short server-side apply reminder to cmd.OutOrStdout().
// Called by the apply RunE when --help is requested (handled by cobra automatically).
func printApplyHelp(cmd *cobra.Command) {
	fmt.Fprintf(cmd.OutOrStdout(),
		"Tip: use 'kcli apply --server-side' for GitOps workflows.\n"+
			"     kcli defaults --field-manager to \"kcli\" in server-side mode.\n")
}
