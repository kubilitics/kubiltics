package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'edit' command with comprehensive help text
//
// 'edit' opens a resource in $EDITOR, validates the changes, and applies
// them on save.  This file replaces the generic passthrough with help text
// that surfaces --validate, --output (yaml vs json), and the --field-manager
// flag important for Server-Side Apply workflows.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newEditCmd returns a first-class 'edit' command with comprehensive help text.
func newEditCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "edit (TYPE NAME | TYPE/NAME) [flags]",
		Short: "Edit a resource on the server in your default editor",
		Long: `Edit a resource in your default editor ($EDITOR).

Opens the resource YAML in your editor. On save-and-quit, kcli sends the
modified manifest back to the API server. Validation errors are shown in
the editor so you can fix them without losing your changes.

Set your editor:
  export EDITOR=vim    # or nano, code --wait, etc.

Important flags (all pass through to kubectl):

  -f, --filename=[]      Edit resources specified in files
  -R, --recursive        Recurse into sub-directories for -f
  -k, --kustomize=DIR    Edit resources from a kustomize directory

  -o, --output=yaml|json Output format for editing (default: yaml)
                         Use json if editing with jq-aware workflows

  --validate=strict|warn|ignore
                         Schema validation level (default: warn)
                         strict  — reject unknown fields (OpenAPI validation)
                         warn    — warn about unknown fields, allow update
                         ignore  — skip validation (use for non-conformant CRDs)

  --field-manager=NAME   Field manager name for Server-Side Apply tracking
                         (default: kubectl-edit)
                         Important for teams tracking who owns which fields

  --save-config          Save the kubectl.kubernetes.io/last-applied-configuration
                         annotation (needed for future kubectl apply compatibility)

  --subresource=STATUS   Edit a subresource (e.g. --subresource=status)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Edit a deployment (opens in $EDITOR)
  kcli edit deployment/api

  # Edit in JSON format (for complex JSONPath queries)
  kcli edit deployment/api -o json

  # Edit with strict schema validation (catch unknown fields immediately)
  kcli edit deployment/api --validate=strict

  # Edit a ConfigMap
  kcli edit configmap/app-config

  # Edit a resource from a file
  kcli edit -f deployment.yaml

  # Edit the status subresource directly
  kcli edit deployment/api --subresource=status

  # Edit with a specific field manager (for SSA workflows)
  kcli edit deployment/api --field-manager=my-team`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"edit"}, clean...))
		},
	}
}
