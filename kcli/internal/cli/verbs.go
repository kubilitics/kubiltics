package cli

// ---------------------------------------------------------------------------
// P0-1: First-class help text for remaining kubectl passthrough commands
//
// The verbs in this file previously used the generic newKubectlVerbCmd
// passthrough (single-line description, no flag documentation). Each now
// has a dedicated command function that surfaces the most important flags
// in Long: — matching the pattern of drain.go, cp.go, describe.go, etc.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import "github.com/spf13/cobra"

// ─── set ──────────────────────────────────────────────────────────────────────

// newSetCmd returns a first-class 'set' command with comprehensive help text.
func newSetCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "set SUBCOMMAND [flags]",
		Short: "Set specific features on objects",
		Long: `Set specific features on one or many objects.

Subcommands:
  image          — Update the image of a pod template
  resources      — Set CPU/memory requests and limits on containers
  env             — Set environment variables on pod templates
  serviceaccount — Set the service account of a pod template
  subject        — Set the subject of a Role/ClusterRole binding
  selector       — Set the selector on a resource

Common flags (all pass through to kubectl):

  -f, --filename=[]        Files identifying the resource to update
  -k, --kustomize=DIR      Process the kustomization directory
  -l, --selector=SELECTOR  Label selector (applies set to matching resources)
  --all                    Select all resources in the namespace
  --all-namespaces, -A     Apply across all namespaces
  -c, --containers=REGEX   The names of containers in the pod template (default "*")
  --local                  If true, set only the local resource, not the server
  --dry-run=client|server  Preview changes without applying them
  --resource-version=VER   If non-empty, the patch only succeeds if the current
                           object's resourceVersion matches this value

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Update the image of a deployment's container
  kcli set image deployment/api api=my-image:v2

  # Update all containers in a deployment
  kcli set image deployment/api '*=my-image:v2'

  # Set CPU/memory limits on all containers in a deployment
  kcli set resources deployment/api --limits=cpu=200m,memory=512Mi

  # Set CPU/memory requests on a specific container
  kcli set resources deployment/api -c api --requests=cpu=100m,memory=256Mi

  # Set an environment variable
  kcli set env deployment/api LOG_LEVEL=debug

  # Remove an environment variable
  kcli set env deployment/api LOG_LEVEL-

  # Change the service account of a deployment
  kcli set serviceaccount deployment/api ci-deployer

  # Dry run to preview changes
  kcli set image deployment/api api=my-image:v2 --dry-run=server`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"set"}, clean...))
		},
	}
}

// ─── replace ──────────────────────────────────────────────────────────────────

// newReplaceCmd returns a first-class 'replace' command with comprehensive help text.
func newReplaceCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "replace -f FILENAME [flags]",
		Short: "Replace a resource by file or stdin",
		Long: `Replace a resource by file or stdin.

JSON and YAML formats are accepted. If replacing an existing resource, the
complete object must be provided — kubectl replace is NOT a partial update.
Use 'kcli patch' for partial updates.

⚠  replace deletes and recreates the resource. Unlike apply (which does a
   strategic merge), replace sends the full object. Any fields not present
   in the file will be removed (e.g. annotations set by other controllers).

Important flags (all pass through to kubectl):

  -f, --filename=[]              File(s) or directory to use for the replacement
  -R, --recursive                Recursively process files/directories in --filename
  -k, --kustomize=DIR            Process a kustomization directory
  --force                        Delete and re-create the resource (more destructive;
                                 also passes --grace-period=0 to the delete step)
  --grace-period=SECONDS         Period of time the resource will be given to terminate
                                 before being forcibly removed (default: -1 = use pod's setting)
  --timeout=DURATION             Maximum time to wait for the replace to complete
                                 (e.g. 5m, 2m30s; 0 = wait indefinitely)
  --cascade=background|orphan|foreground
                                 Cascade strategy for deleting dependent objects (default: background)
  --dry-run=client|server        Preview what would be replaced without applying
  --subresource=SUBRESOURCE      Replace a subresource (e.g. status, scale)
  --field-manager=NAME           Name of the field manager for the replacement

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Replace a pod using a JSON file
  kcli replace -f pod.json

  # Replace a resource using a YAML file
  kcli replace -f deployment.yaml

  # Replace from stdin (pipe)
  cat pod.yaml | kcli replace -f -

  # Force-replace (delete + create) a pod — useful when immutable fields changed
  kcli replace --force -f pod.yaml

  # Dry run to see what would change
  kcli replace -f deployment.yaml --dry-run=server

  # Replace all YAML files in a directory
  kcli replace -f ./manifests/ -R`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"replace"}, clean...))
		},
	}
}

// ─── proxy ────────────────────────────────────────────────────────────────────

// newProxyCmd returns a first-class 'proxy' command with comprehensive help text.
func newProxyCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "proxy [flags]",
		Short: "Run a proxy to the Kubernetes API server",
		Long: `Run a proxy to the Kubernetes API server on localhost.

The proxy handles authentication — you can query the API directly with
plain HTTP without any credentials. This is useful for exploring the API,
debugging, or local development without kubectl.

Important flags (all pass through to kubectl):

  --port=PORT, -p PORT     Port on which the proxy listens (default: 8001)
                           Use 0 for a random available port

  --address=IP             IP to listen on (default: 127.0.0.1)
                           ⚠  Use 0.0.0.0 only in private networks — this
                              exposes the full Kubernetes API without authentication

  --unix-socket=PATH       Unix socket on which to run the proxy (alternative to --port)

  --www-dir=DIR, -w DIR    Static files directory to serve at /static/
  --www-prefix=PREFIX, -P  Prefix to serve static files under (default: /static/)

  --api-prefix=PREFIX      Prefix to serve the proxied API under (default: /)
                           Useful when running behind a reverse proxy

  --accept-hosts=REGEX     Regular expression for hosts to accept requests for
                           (default: localhost|127.0.0.1|::1|\[::1\])
                           ⚠  Do not change unless you understand the security implications

  --accept-paths=REGEX     Paths to accept in the proxy (default: ^.*)
  --reject-paths=REGEX     Paths to reject (default: ^/api/.*/pods/.*/exec,^/api/.*/pods/.*/attach)
  --reject-methods=REGEX   HTTP methods to reject (default: "")

  --keepalive=DURATION     Keepalive specifies the keep-alive period for an active network
                           connection (default: 0, disabled)

  --disable-filter         If true, disable request filtering in the proxy
                           ⚠  Dangerous — makes exec/attach available through proxy

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command

Examples:

  # Start a proxy on the default port (8001)
  kcli proxy
  # → curl http://localhost:8001/api/v1/namespaces

  # Start a proxy on a specific port
  kcli proxy --port=8080
  # → curl http://localhost:8080/api/v1/pods

  # List all pods via the proxy API
  curl http://localhost:8001/api/v1/namespaces/default/pods | jq '.items[].metadata.name'

  # Access a service via the proxy (without port-forward)
  kcli proxy &
  curl http://localhost:8001/api/v1/namespaces/production/services/my-svc:80/proxy/

  # Use a random port (useful in scripts)
  kcli proxy --port=0`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"proxy"}, clean...))
		},
	}
}

// ─── attach ───────────────────────────────────────────────────────────────────

// newAttachCmd returns a first-class 'attach' command with comprehensive help text.
func newAttachCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "attach (POD | TYPE/NAME) [flags]",
		Short: "Attach to a running container",
		Long: `Attach to a process running in a container.

Unlike 'exec', attach connects to the ALREADY RUNNING process (PID 1) of
the container, rather than starting a new one. This is useful for:
  - Viewing live output from a process that was not started with -it
  - Sending input to an interactive process (e.g. a Python REPL)
  - Debugging processes that write directly to stdout/stderr

⚠  Detaching from an attached container:
   Press Ctrl+P Ctrl+Q to detach without stopping the container.
   Ctrl+C will send SIGINT to the container process — this may stop the process.

Important flags (all pass through to kubectl):

  -c, --container=NAME   Container name (required for multi-container pods)
                         Run 'kcli describe pod/NAME' to see container names.
                         Defaults to the first container if not specified.

  -i, --stdin            Pass stdin to the container (default: false)
                         Required if the running process expects input.

  -t, --tty              Stdin is a TTY (default: false)
                         Use with -i for interactive sessions (e.g. shells, REPLs)

  --pod-running-timeout  Time to wait for the pod to be running (default: 1m)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Attach to the default container of a pod
  kcli attach pod/my-pod

  # Attach with stdin and TTY (for interactive sessions)
  kcli attach pod/my-pod -it

  # Attach to a specific container in a multi-container pod
  kcli attach pod/my-pod -c sidecar

  # Attach to a deployment (kcli picks a running pod)
  kcli attach deployment/api -c api -it

Note: For running a new command in a container, use 'kcli exec' instead:
  kcli exec pod/my-pod -- bash`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"attach"}, clean...))
		},
	}
}

// ─── autoscale ────────────────────────────────────────────────────────────────

// newAutoscaleCmd returns a first-class 'autoscale' command with comprehensive help text.
func newAutoscaleCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "autoscale TYPE NAME [flags]",
		Short: "Auto-scale a workload based on CPU utilization",
		Long: `Auto-scale a Deployment, ReplicaSet, StatefulSet, or ReplicationController.

Creates a HorizontalPodAutoscaler (HPA) that automatically scales the target
workload based on CPU utilization (and memory, if --memory-percent is supported).

⚠  For production autoscaling with memory metrics or custom metrics, use
   'kcli apply -f hpa.yaml' directly — the autoscale command only supports
   CPU utilization via the autoscaling/v1 API.

Important flags (all pass through to kubectl):

  --min=N                Minimum number of replicas (default: 1)
                         The autoscaler will not scale below this value.

  --max=N                Maximum number of replicas (REQUIRED)
                         The autoscaler will not scale above this value.

  --cpu-percent=N        Target average CPU utilization as a percentage of
                         the resource request (default: 80)
                         The autoscaler scales to keep CPU at or below this value.

  --name=NAME            Name of the HPA object (default: same as target)

  -f, --filename=[]      Files to create the HPA from

  --dry-run=client|server  Preview the HPA that would be created

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Autoscale a deployment between 2 and 10 replicas at 50% CPU
  kcli autoscale deployment/api --min=2 --max=10 --cpu-percent=50

  # Autoscale with default CPU target (80%)
  kcli autoscale deployment/api --min=3 --max=15

  # Autoscale a StatefulSet
  kcli autoscale statefulset/db --min=1 --max=5 --cpu-percent=60

  # Dry run — see the HPA that would be created
  kcli autoscale deployment/api --min=2 --max=10 --dry-run=client -o yaml

  # View the resulting HPA
  kcli get hpa api

  # For advanced autoscaling (memory, custom metrics), use an HPA manifest:
  kcli apply -f hpa.yaml`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"autoscale"}, clean...))
		},
	}
}

// ─── cluster-info ─────────────────────────────────────────────────────────────

// newClusterInfoCmd returns a first-class 'cluster-info' command with comprehensive help text.
func newClusterInfoCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "cluster-info [dump] [flags]",
		Short: "Display cluster info and core endpoint URLs",
		Long: `Display addresses of the master and cluster services.

Without subcommands, prints the control plane and CoreDNS endpoints.

Subcommand:
  dump   Dump cluster state to stdout or a directory for debugging.
         Collects: pod logs, events, namespace info, and resource manifests.
         This is the first thing to run when filing a Kubernetes bug report.

Important flags for 'cluster-info dump' (all pass through to kubectl):

  --namespaces=ns1,ns2       Namespaces to dump (default: kube-system)
  --all-namespaces, -A       Dump all namespaces (produces a lot of output)
  --output-directory=DIR     Write dump files to a directory
                             (default: stdout as a single stream)
  --allow-missing-template-keys
                             If true, ignore any errors from missing keys

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command

Examples:

  # Show cluster endpoints
  kcli cluster-info

  # Dump all cluster state to a local directory (for bug reports)
  kcli cluster-info dump --output-directory=/tmp/cluster-state

  # Dump specific namespaces
  kcli cluster-info dump --namespaces=kube-system,monitoring

  # Dump everything (large output)
  kcli cluster-info dump -A --output-directory=/tmp/full-dump

  # Pipe dump to gzip for archiving
  kcli cluster-info dump | gzip > /tmp/cluster-dump.gz`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"cluster-info"}, clean...))
		},
	}
}

// ─── certificate ──────────────────────────────────────────────────────────────

// newCertificateCmd returns a first-class 'certificate' command with comprehensive help text.
func newCertificateCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "certificate SUBCOMMAND [flags]",
		Short: "Approve or deny certificate signing requests",
		Long: `Modify CertificateSigningRequest (CSR) resources.

When users or workloads request TLS certificates via the Kubernetes CSR API,
a cluster admin must approve or deny the request. Approved requests are signed
by the cluster CA; denied requests are rejected.

Subcommands:
  approve   Approve a pending CSR — the cluster CA signs the certificate
  deny      Deny a pending CSR — the requester receives an error

Important flags (all pass through to kubectl):

  --force             Force the approval/denial even if the CSR is already
                      approved, denied, or the condition is already set

  --rotated-client-cert
                      If set, the CSR is for a rotated client certificate

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command

Examples:

  # List pending CSRs
  kcli get csr

  # Approve a CSR (the cluster CA will sign the certificate)
  kcli certificate approve my-csr

  # Deny a CSR
  kcli certificate deny my-csr

  # Approve all pending CSRs (use with care)
  kcli get csr -o name | grep Pending | xargs kcli certificate approve

Workflow for manual certificate approval:
  1. User creates a CSR: kubectl create -f csr.yaml
  2. Admin views pending CSRs: kcli get csr
  3. Admin approves: kcli certificate approve <csr-name>
  4. User retrieves signed cert: kubectl get csr/<name> -o jsonpath='{.status.certificate}' | base64 -d`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"certificate"}, clean...))
		},
	}
}

// ─── token ────────────────────────────────────────────────────────────────────

// newTokenCmd returns a first-class 'token' command with comprehensive help text.
func newTokenCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "token SERVICE_ACCOUNT [flags]",
		Short: "Request a service account token",
		Long: `Request a service account token.

Creates a TokenRequest for the given service account and prints the token.
Unlike legacy service account tokens (Secret-based), tokens created with this
command are:
  - Time-limited (default 1 hour, configurable with --duration)
  - Audience-bound (for specific API servers or services)
  - Optionally pod-bound (token becomes invalid when the pod exits)

Use cases:
  - Testing service account permissions without creating a long-lived secret
  - Getting a short-lived token for CI/CD pipeline authentication
  - Creating audience-scoped tokens for service-to-service communication

Important flags (all pass through to kubectl):

  --duration=DURATION      Token validity duration (default: 1 hour)
                           Examples: 30m, 2h, 24h
                           Minimum: 10 minutes
                           Maximum: depends on cluster API server configuration

  --audience=AUDIENCE      Intended audience for the token (default: API server)
                           Use the audience of the service that will verify the token.
                           Can be specified multiple times.

  --bound-object-kind=KIND  Kind of the object the token will be bound to
                            When the bound object is deleted, the token is invalidated.
                            Supported: Pod, Secret

  --bound-object-name=NAME  Name of the object to bind the token to

  --bound-object-uid=UID    UID of the object to bind the token to

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Get a 1-hour token for a service account
  kcli token my-service-account

  # Get a 30-minute token
  kcli token my-service-account --duration=30m

  # Get a token for a specific audience (e.g. a Vault server)
  kcli token my-service-account --audience=https://vault.example.com

  # Get a token bound to a specific pod (token expires when pod exits)
  kcli token my-service-account --bound-object-kind=Pod --bound-object-name=my-pod

  # Use the token to authenticate kubectl in a CI pipeline
  TOKEN=$(kcli token ci-runner -n ci)
  kubectl --token="$TOKEN" get pods`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"token"}, clean...))
		},
	}
}

// ─── kustomize ────────────────────────────────────────────────────────────────

// newKustomizeCmd returns a first-class 'kustomize' command with comprehensive help text.
func newKustomizeCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "kustomize DIR [flags]",
		Short:   "Build a kustomization target from a directory or URL",
		Aliases: []string{"ks"},
		Long: `Build a set of KRM resources using a kustomization.yaml file.

Reads the kustomization.yaml from DIR (a local directory or remote URL),
applies all patches and transformations, and prints the resulting manifests
to stdout. Pipe to 'kcli apply -f -' to apply the output to the cluster.

Important flags (all pass through to kubectl):

  -o, --output=FORMAT     Output format (default: yaml)
                          yaml — YAML manifests (default)
                          json — JSON format

  --enable-alpha-plugins  Enable kustomize alpha plugins (generators and transformers)
                          Plugins run arbitrary code — only use from trusted sources.

  --enable-exec           Enable exec plugins (requires --enable-alpha-plugins)

  --enable-helm           Enable use of the Helm chart inflator as a generator

  --helm-command=CMD      Helm command to use (default: helm)
                          Set if helm is not on PATH or you need a specific version.

  --load-restrictor=POLICY
                          Controls where kustomize can load files from.
                          none         — no restriction (can load from anywhere)
                          LoadRestrictionsRootOnly — only load from the kustomization root (default)
                          ⚠  Only use 'none' when you trust all kustomization sources.

  --reorder=POLICY        Reorder resource output (default: legacy)
                          legacy  — legacy ordering (Namespaces first, then by kind)
                          none    — preserve original order

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command

Examples:

  # Build a kustomization from a local directory
  kcli kustomize ./overlays/production

  # Build and pipe directly to apply
  kcli kustomize ./overlays/production | kcli apply -f -

  # Build from a remote Git repository
  kcli kustomize https://github.com/myorg/k8s-config/overlays/staging

  # Build with Helm chart support enabled
  kcli kustomize ./my-chart-overlay --enable-helm

  # Build with alpha plugins (generators, transformers)
  kcli kustomize ./my-overlay --enable-alpha-plugins

  # Build and output as JSON
  kcli kustomize ./overlays/prod -o json | jq '.items[].metadata.name'

  # Alias: kcli ks works the same way
  kcli ks ./overlays/staging | kcli apply -f -`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"kustomize"}, clean...))
		},
	}
}
