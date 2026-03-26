package v2

import (
	"context"
	"log/slog"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"golang.org/x/sync/errgroup"
)

// CollectFromClient fills a ResourceBundle by listing resources from the given k8s client.
// Namespace filters namespaced resources; empty means all namespaces.
func CollectFromClient(ctx context.Context, client *k8s.Client, namespace string) (*ResourceBundle, error) {
	if client == nil || client.Clientset == nil {
		return nil, nil
	}
	cs := client.Clientset
	opts := metav1.ListOptions{}
	nsOpts := namespace
	if namespace == "" {
		nsOpts = metav1.NamespaceAll
	}
	bundle := &ResourceBundle{}
	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		list, err := cs.CoreV1().Pods(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect pods", "error", err)
			return nil
		}
		bundle.Pods = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().Deployments(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect deployments", "error", err)
			return nil
		}
		bundle.Deployments = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().ReplicaSets(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect replicasets", "error", err)
			return nil
		}
		bundle.ReplicaSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().StatefulSets(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect statefulsets", "error", err)
			return nil
		}
		bundle.StatefulSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AppsV1().DaemonSets(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect daemonsets", "error", err)
			return nil
		}
		bundle.DaemonSets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.BatchV1().Jobs(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect jobs", "error", err)
			return nil
		}
		bundle.Jobs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.BatchV1().CronJobs(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect cronjobs", "error", err)
			return nil
		}
		bundle.CronJobs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Services(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect services", "error", err)
			return nil
		}
		bundle.Services = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Endpoints(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect endpoints", "error", err)
			return nil
		}
		bundle.Endpoints = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.DiscoveryV1().EndpointSlices(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect endpointlices", "error", err)
			return nil
		}
		bundle.EndpointSlices = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().Ingresses(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect ingresses", "error", err)
			return nil
		}
		bundle.Ingresses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().IngressClasses().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect ingressclasses", "error", err)
			return nil
		}
		bundle.IngressClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ConfigMaps(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect configmaps", "error", err)
			return nil
		}
		bundle.ConfigMaps = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Secrets(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect secrets", "error", err)
			return nil
		}
		bundle.Secrets = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().PersistentVolumeClaims(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect pvcs", "error", err)
			return nil
		}
		bundle.PVCs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().PersistentVolumes().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect pvs", "error", err)
			return nil
		}
		bundle.PVs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.StorageV1().StorageClasses().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect storageclasses", "error", err)
			return nil
		}
		bundle.StorageClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Nodes().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect nodes", "error", err)
			return nil
		}
		bundle.Nodes = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().Namespaces().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect namespaces", "error", err)
			return nil
		}
		bundle.Namespaces = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ServiceAccounts(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect serviceaccounts", "error", err)
			return nil
		}
		bundle.ServiceAccounts = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().Roles(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect roles", "error", err)
			return nil
		}
		bundle.Roles = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().RoleBindings(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect rolebindings", "error", err)
			return nil
		}
		bundle.RoleBindings = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().ClusterRoles().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect clusterroles", "error", err)
			return nil
		}
		bundle.ClusterRoles = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.RbacV1().ClusterRoleBindings().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect clusterrolebindings", "error", err)
			return nil
		}
		bundle.ClusterRoleBindings = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AutoscalingV2().HorizontalPodAutoscalers(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect hpas", "error", err)
			return nil
		}
		bundle.HPAs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.PolicyV1().PodDisruptionBudgets(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect pdbs", "error", err)
			return nil
		}
		bundle.PDBs = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NetworkingV1().NetworkPolicies(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect networkpolicies", "error", err)
			return nil
		}
		bundle.NetworkPolicies = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.SchedulingV1().PriorityClasses().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect priorityclasses", "error", err)
			return nil
		}
		bundle.PriorityClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.NodeV1().RuntimeClasses().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect runtimeclasses", "error", err)
			return nil
		}
		bundle.RuntimeClasses = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AdmissionregistrationV1().MutatingWebhookConfigurations().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect mutatingwebhooks", "error", err)
			return nil
		}
		bundle.MutatingWebhooks = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect validatingwebhooks", "error", err)
			return nil
		}
		bundle.ValidatingWebhooks = list.Items
		return nil
	})

	g.Go(func() error {
		list, err := cs.CoreV1().Events(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect events", "error", err)
			return nil
		}
		bundle.Events = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().ResourceQuotas(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect resourcequotas", "error", err)
			return nil
		}
		bundle.ResourceQuotas = list.Items
		return nil
	})
	g.Go(func() error {
		list, err := cs.CoreV1().LimitRanges(nsOpts).List(gctx, opts)
		if err != nil {
			slog.Warn("topology v2 collect limitranges", "error", err)
			return nil
		}
		bundle.LimitRanges = list.Items
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}
	return bundle, nil
}
