package cli

import (
	"context"
	"time"

	"github.com/kubilitics/kcli/internal/informer"
	"github.com/kubilitics/kcli/internal/k8sclient"
	"github.com/kubilitics/kcli/internal/ui"
	"github.com/spf13/cobra"
)

func newUICmd(a *app) *cobra.Command {
	var readOnly bool
	cmd := &cobra.Command{
		Use:   "ui",
		Short: "Launch interactive Kubernetes TUI",
		Long: `Launch the interactive TUI. Uses watch-based informers when a cluster is reachable (zero poll overhead). Falls back to 2-second kubectl polling otherwise.

Flags:
  --read-only    Disable all mutation operations (edit, exec, bulk-delete/scale,
                 port-forward). A [READ-ONLY] badge is displayed in the header.
                 Also configurable via: kcli config set tui.readOnly true`,
		GroupID: "workflow",
		RunE: func(_ *cobra.Command, _ []string) error {
			opts := a.uiOptions()

			// --read-only flag ORs with the config-file value — either one enables it.
			if readOnly {
				opts.ReadOnly = true
			}

			// Attempt to start an informer-backed store for push-based TUI updates.
			// If the cluster is unreachable or times out, fall back to polling silently.
			if store := tryStartInformerStore(a); store != nil {
				opts.InformerSnapshot = store.SnapshotLines
				opts.InformerNotify = store.NotifyCh
				defer store.Stop()
			}

			return ui.Run(opts)
		},
	}
	cmd.Flags().BoolVar(&readOnly, "read-only", false, "Disable all mutation operations in the TUI (edit, exec, bulk ops, port-forward)")
	return cmd
}

// tryStartInformerStore builds a kubernetes client bundle and starts a
// SharedInformerFactory-backed Store. Returns nil (without error) if the
// cluster cannot be reached within 5 seconds so the TUI can fall back to
// polling gracefully.
func tryStartInformerStore(a *app) *informer.Store {
	bundle, err := k8sclient.NewBundle(a.kubeconfig, a.context)
	if err != nil {
		return nil
	}
	store := informer.New(bundle.Clientset, a.namespace, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := store.Start(ctx); err != nil {
		store.Stop()
		return nil
	}
	return store
}
