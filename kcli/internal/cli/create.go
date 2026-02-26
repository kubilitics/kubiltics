package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'create' command with comprehensive help text
//
// 'create' is the third most common kubectl command.  The distinction between
// declarative (apply) and imperative (create) is frequently misunderstood.
// This file surfaces all imperative subcommands and the key flags.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newCreateCmd returns a first-class 'create' command with comprehensive help text.
func newCreateCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "create (TYPE/NAME | -f FILENAME | subcommand) [flags]",
		Short:   "Create a resource from a file, URL, or imperative subcommand",
		Aliases: []string{"cr"},
		Long: `Create a resource from a file or from standard input.

Prefer 'kcli apply' for declarative workflows (GitOps, Helm, Kustomize).
Use 'kcli create' for imperative one-off resource creation.

Key difference from apply:
  create — fails if the resource already exists
  apply  — creates OR updates the resource (idempotent)

Important flags (all pass through to kubectl):

  -f, --filename=[]      Files, directories, or URLs of the resources to create
  -k, --kustomize=DIR    Kustomize directory
  -R, --recursive        Recurse into sub-directories for -f

  --dry-run=none|client|server
                         Preview without creating
                         server — most accurate; detects naming conflicts

  --save-config          Save the last-applied-configuration annotation
                         (enables future 'kubectl apply' to manage the resource)

  --validate=strict|warn|ignore
                         Schema validation level (default: warn)

  -o, --output=FORMAT    Output format (yaml, json, name, jsonpath=...)
                         name — prints "resourcetype/name" (useful in scripts)

  --field-manager=NAME   Field manager name for SSA tracking

Imperative subcommands (all pass through to kubectl create <subcommand>):

  namespace <name>       Create a namespace
  deployment             Create a deployment
  service / svc          Create a service (clusterip, nodeport, loadbalancer, externalname)
  configmap / cm         Create a configmap
  secret                 Create a secret (generic, docker-registry, tls)
  serviceaccount / sa    Create a service account
  role                   Create a role (RBAC)
  clusterrole            Create a cluster role
  rolebinding            Create a role binding
  clusterrolebinding     Create a cluster role binding
  job                    Create a job
  cronjob                Create a cron job
  ingress / ing          Create an ingress
  quota                  Create a resource quota
  priorityclass / pc     Create a priority class

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Create from a manifest file
  kcli create -f deployment.yaml

  # Imperative: create a namespace
  kcli create namespace my-team

  # Imperative: create a ConfigMap from key/value pairs
  kcli create configmap app-config --from-literal=LOG_LEVEL=info --from-literal=PORT=8080

  # Imperative: create a ConfigMap from a file
  kcli create configmap nginx-config --from-file=./nginx.conf

  # Imperative: create a generic secret
  kcli create secret generic db-creds \
    --from-literal=username=admin \
    --from-literal=password=supersecret

  # Imperative: create a TLS secret
  kcli create secret tls my-cert --cert=tls.crt --key=tls.key

  # Imperative: create a ServiceAccount
  kcli create serviceaccount ci-deployer

  # Dry-run to preview YAML without creating
  kcli create namespace staging --dry-run=client -o yaml

  # Create and immediately show the result
  kcli create -f deployment.yaml && kcli rollout status deployment/my-app`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"create"}, clean...))
		},
	}
}
