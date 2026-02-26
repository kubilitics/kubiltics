package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'expose' and 'run' commands with comprehensive help text
//
// These imperative creation commands are used in quick debugging sessions and
// CI/CD pipelines.  Their flags are completely invisible in the generic
// passthrough — this file documents them properly.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newExposeCmd returns a first-class 'expose' command with comprehensive help text.
func newExposeCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "expose (TYPE NAME | TYPE/NAME) --port=PORT [flags]",
		Short: "Expose a workload as a Kubernetes service",
		Long: `Expose a resource as a new Kubernetes Service.

Takes a running resource (pod, deployment, service, ReplicationController,
ReplicaSet, or StatefulSet) and creates a Service that selects it.

Service type reference:
  ClusterIP      (default) — internal-only IP, accessible within the cluster
  NodePort       — exposes on each node's IP at a static port (30000-32767)
  LoadBalancer   — provisions a cloud load balancer (AWS ALB, GCP LB, etc.)
  ExternalName   — maps to an external DNS name (no proxy)

Important flags (all pass through to kubectl):

  --port=PORT            Port the service will listen on (REQUIRED)
                         For multi-port: --port=80:8080 (service:container)

  --target-port=PORT     Container port to target (default: same as --port)

  --type=TYPE            Service type: ClusterIP|NodePort|LoadBalancer|ExternalName
                         (default: ClusterIP)

  --name=NAME            Name for the new service (default: same as resource)

  --protocol=TCP|UDP|SCTP  Network protocol (default: TCP)

  --selector=KEY=VALUE   Override the selector (default: copies from resource)

  --cluster-ip=IP        ClusterIP address to assign (default: auto-assigned)

  --load-balancer-ip=IP  IP to assign to the LoadBalancer (cloud-specific)

  --external-ip=IP       Additional external IP to assign

  --dry-run=none|client|server
                         Preview without creating

  -o, --output=FORMAT    Output format (yaml, json, name)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Expose a deployment as a ClusterIP service on port 80
  kcli expose deployment/api --port=80 --target-port=8080

  # Expose as a NodePort for external testing
  kcli expose deployment/api --type=NodePort --port=80 --target-port=8080

  # Expose as a LoadBalancer (cloud environments)
  kcli expose deployment/api --type=LoadBalancer --port=80 --target-port=8080

  # Preview the generated service YAML
  kcli expose deployment/api --port=80 --dry-run=client -o yaml

  # Expose on a custom name
  kcli expose deployment/api --port=80 --name=api-external --type=LoadBalancer`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"expose"}, clean...))
		},
	}
}

// newRunCmd returns a first-class 'run' command with comprehensive help text.
func newRunCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "run NAME --image=IMAGE [flags]",
		Short: "Run a pod from an image (imperative, for debugging)",
		Long: `Create and run a pod from an image.

⚠  'run' is an imperative command for quick testing and debugging.
   For production workloads, use 'kcli apply' with a Deployment manifest.

run is particularly useful for:
  - One-off debugging pods (ephemeral containers)
  - Testing connectivity, DNS, or image availability
  - Running a quick job without writing YAML

Important flags (all pass through to kubectl):

  --image=IMAGE              Container image to run (REQUIRED)
                             e.g. --image=nginx:1.25, --image=busybox:latest

  --env=KEY=VALUE            Environment variable (repeatable)
                             e.g. --env=LOG_LEVEL=debug --env=PORT=8080

  --port=PORT                Container port to expose

  --restart=Always|OnFailure|Never
                             Pod restart policy (default: Always)
                             Always     — creates a Deployment
                             OnFailure  — creates a Job
                             Never      — creates a bare pod (useful for debugging)

  --rm                       Delete the pod automatically when it exits
                             Use with -i -t for interactive debugging sessions

  -i, --stdin                Keep stdin open (for interactive sessions)
  -t, --tty                  Allocate a pseudo-TTY (combine with -i for shell access)

  --command                  Override container ENTRYPOINT
  -- <cmd> [args...]         Override container CMD (after the --)

  --image-pull-policy=Always|IfNotPresent|Never
                             When to pull the image (default: IfNotPresent)
                             Use Always for :latest or rolling tags

  --serviceaccount=NAME      ServiceAccount to use (for testing RBAC)

  --limits=cpu=N,memory=N    Resource limits (e.g. --limits=cpu=500m,memory=256Mi)
  --requests=cpu=N,memory=N  Resource requests

  -l, --labels=KEY=VALUE     Pod labels

  --dry-run=none|client|server  Preview without creating
  -o, --output=FORMAT        Output format (yaml useful with --dry-run for scaffolding)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Run a temporary debugging pod with shell access
  kcli run debug --image=busybox -i -t --rm --restart=Never -- sh

  # Run a netshoot debug pod for network troubleshooting
  kcli run netshoot --image=nicolaka/netshoot -i -t --rm --restart=Never -- bash

  # Test DNS resolution
  kcli run dns-test --image=busybox --restart=Never --rm -- nslookup kubernetes.default.svc.cluster.local

  # Quick nginx test (creates a Deployment)
  kcli run nginx-test --image=nginx:1.25 --port=80

  # Generate a pod YAML without creating (for scaffolding)
  kcli run myapp --image=myapp:v1 --restart=Never --dry-run=client -o yaml > pod.yaml

  # Run with specific resource limits
  kcli run load-test --image=alpine --restart=Never --limits=cpu=100m,memory=128Mi -- sleep 3600`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"run"}, clean...))
		},
	}
}
