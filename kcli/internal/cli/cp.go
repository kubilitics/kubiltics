package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'cp' command with comprehensive help text
//
// 'cp' is essential for debugging — copying files to/from pods.  The -c flag
// (container selection) is critical for multi-container pods but completely
// invisible in the generic passthrough.  This file surfaces all important
// flags including --retries for unreliable network environments.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newCpCmd returns a first-class 'cp' command with comprehensive help text.
func newCpCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "cp <file-spec-src> <file-spec-dest> [flags]",
		Short: "Copy files and directories to and from containers",
		Long: `Copy files and directories to and from containers.

File spec formats:
  pod/name:/path/to/file       — file inside a pod (current namespace)
  namespace/pod/name:/path     — file inside a pod in a specific namespace
  /local/path                  — file on your local machine

Directions:
  kcli cp pod/name:/remote/path /local/path    — download from pod
  kcli cp /local/path pod/name:/remote/path    — upload to pod
  kcli cp pod/a:/path1 pod/b:/path2            — copy between pods

⚠  Requires 'tar' to be available inside the container.

Important flags (all pass through to kubectl):

  -c, --container=NAME     Container name (REQUIRED for multi-container pods)
                           Run 'kcli describe pod/NAME' to see container names.
                           Without -c, kubectl selects the first container.

  --no-preserve            Do not preserve timestamps and file mode on copy
                           (use when the target filesystem doesn't support them)

  --retries=N              Number of retries on failure (default: 0)
                           Useful for unreliable networks or large files:
                           kcli cp ... --retries=5

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Download a log file from a pod
  kcli cp pod/api-xyz:/var/log/app/app.log /tmp/app.log

  # Upload a config file to a specific container
  kcli cp ./config.json pod/api-xyz:/app/config.json -c api-server

  # Download an entire directory
  kcli cp pod/api-xyz:/app/data /tmp/data

  # Copy with retries (for large files or flaky connections)
  kcli cp pod/api-xyz:/tmp/large-dump.sql /tmp/dump.sql --retries=3

  # Copy to a specific namespace's pod
  kcli cp production/api-xyz:/app/config /tmp/prod-config

  # Upload without preserving file metadata
  kcli cp ./data pod/api-xyz:/tmp/data --no-preserve

Tip: combine with kcli exec for complex debugging:
  kcli exec pod/api-xyz -- tar czf /tmp/logs.tar.gz /var/log/app
  kcli cp pod/api-xyz:/tmp/logs.tar.gz /tmp/logs.tar.gz`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"cp"}, clean...))
		},
	}
}
