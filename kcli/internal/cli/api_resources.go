package cli

// ---------------------------------------------------------------------------
// P3-7: api-resources and api-versions as first-class commands
//
// kubectl api-resources and api-versions are heavily used for CRD discovery,
// RBAC auditing, and understanding what APIs a cluster supports.  These
// first-class wrappers surface all important flags in --help output and
// shell completion while preserving full kubectl passthrough behaviour.
//
// Key flags surfaced for api-resources:
//   --verbs=create,delete     filter by supported verbs
//   --namespaced=true|false   filter by namespace scope
//   --api-group=GROUP         filter by API group
//   --categories=CAT          filter by resource category (e.g. all, storage)
//   --sort-by=name|kind       sort output column
//   -o, --output=wide|name    output format
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newAPIResourcesCmd returns a first-class 'api-resources' command that
// documents all useful discovery and filtering flags in its --help output.
func newAPIResourcesCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "api-resources [flags]",
		Short: "Print the supported API resources on the server",
		Long: `List the API resources available in the connected cluster.

This command is essential for CRD discovery, RBAC auditing, and understanding
what Kubernetes APIs are available before writing manifests or automation.

Filtering flags (all pass through to kubectl):

  --api-group=GROUP           Limit to resources in the specified API group
                              Examples: apps, batch, networking.k8s.io, ''(core)
  --namespaced                If true (default), only namespaced resources
                              Pass --namespaced=false for cluster-scoped resources
  --verbs=VERB[,VERB...]      Only show resources that support the specified verbs
                              Examples: --verbs=get,list --verbs=create,delete
  --categories=CAT[,CAT...]  Only show resources in the specified category
                              Examples: --categories=all --categories=storage

Output flags:

  -o, --output=wide|name      wide: include SHORTNAMES, APIVERSION, NAMESPACED, KIND
                              name: resource/name pairs only (machine-parseable)
  --sort-by=name|kind         Sort by the NAME or KIND column (default: NAME)
  --cached                    Use the cached list of resources (faster, may be stale)
  --request-timeout=DURATION  Timeout for the API request (e.g. 10s, 1m)

Examples:

  # List all resources in the cluster
  kcli api-resources

  # List all resources with full details (verbs, categories, etc.)
  kcli api-resources -o wide

  # Find resources that support delete (useful before writing cleanup scripts)
  kcli api-resources --verbs=delete

  # List only namespaced resources
  kcli api-resources --namespaced=true

  # List only cluster-scoped resources (Nodes, PersistentVolumes, etc.)
  kcli api-resources --namespaced=false

  # Find all resources in the apps API group
  kcli api-resources --api-group=apps

  # Find all CRDs (resources in custom API groups, excluding core and built-ins)
  kcli api-resources --api-group=''
  kcli api-resources -o wide | grep -v 'k8s.io'

  # Resources supporting the 'scale' verb (scalable workloads)
  kcli api-resources --verbs=get,list,scale -o wide

  # Machine-parseable list (one resource per line)
  kcli api-resources -o name

  # In a different cluster/namespace context (kcli feature)
  kcli api-resources --context=prod-east`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"api-resources"}, clean...))
		},
	}
}

// newAPIVersionsCmd returns a first-class 'api-versions' command that
// explains the group/version format and its relationship to api-resources.
func newAPIVersionsCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "api-versions",
		Short: "Print the supported API versions on the server",
		Long: `Print the supported API versions on the server, in the form "group/version".

The output lists every API group and version the cluster exposes.  This is
useful for:
  - Finding the correct apiVersion for a manifest (e.g. apps/v1, batch/v1)
  - Verifying that a CRD has been installed (look for its custom group)
  - Auditing which beta/alpha APIs are still enabled on the cluster

Output format: "group/version" pairs, one per line.
Core group resources (Pod, Service, etc.) appear as "v1" (no group prefix).

Examples:

  # List all supported API versions
  kcli api-versions

  # Grep for a specific group to verify CRD installation
  kcli api-versions | grep cert-manager

  # Check whether a beta API is still available
  kcli api-versions | grep 'v1beta'

  # Combine with api-resources to find resources for a specific version
  kcli api-resources --api-group=networking.k8s.io

  # In a different context (kcli feature)
  kcli api-versions --context=staging`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"api-versions"}, clean...))
		},
	}
}
