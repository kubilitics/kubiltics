package k8s

import (
	"context"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const (
	ProviderEKS           = "EKS"
	ProviderGKE           = "GKE"
	ProviderAKS           = "AKS"
	ProviderOpenShift     = "OpenShift"
	ProviderRancher       = "Rancher"
	ProviderK3s           = "k3s"
	ProviderKind          = "Kind"
	ProviderMinikube      = "Minikube"
	ProviderDockerDesktop = "Docker Desktop"
	ProviderOnPrem        = "on-prem"
)

// DetectProvider identifies the Kubernetes distribution (EKS, GKE, AKS, Kind, etc.)
// using node labels, server URL, kube-system namespace, and context name.
func (c *Client) DetectProvider(ctx context.Context) (string, error) {
	if err := c.waitRateLimit(ctx); err != nil {
		return ProviderOnPrem, err
	}
	ctx, cancel := c.withTimeout(ctx)
	defer cancel()

	serverURL := ""
	if c.Config != nil && c.Config.Host != "" {
		serverURL = strings.ToLower(c.Config.Host)
	}
	contextName := strings.ToLower(c.Context)

	// 1. Server URL patterns (cloud APIs)
	if strings.Contains(serverURL, "eks.") || strings.Contains(serverURL, "amazonaws.com") {
		return ProviderEKS, nil
	}
	if strings.Contains(serverURL, "gke.") || strings.Contains(serverURL, "googleapis.com") {
		return ProviderGKE, nil
	}
	if strings.Contains(serverURL, "azmk8s.io") || strings.Contains(serverURL, "azure.com") {
		return ProviderAKS, nil
	}

	// 2. Context name (local dev tools)
	if strings.Contains(contextName, "docker-desktop") || strings.Contains(contextName, "docker-for-desktop") {
		return ProviderDockerDesktop, nil
	}
	if strings.Contains(contextName, "minikube") {
		return ProviderMinikube, nil
	}
	if strings.Contains(contextName, "kind-") || strings.Contains(contextName, "kind") {
		return ProviderKind, nil
	}

	// 3. Node labels (most reliable when available)
	nodes, err := c.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{Limit: 10})
	if err == nil && len(nodes.Items) > 0 {
		for _, n := range nodes.Items {
			for k, v := range n.Labels {
				kl := strings.ToLower(k)
				if strings.Contains(kl, "eks.amazonaws.com") {
					return ProviderEKS, nil
				}
				if strings.Contains(kl, "cloud.google.com/gke") {
					return ProviderGKE, nil
				}
				if strings.Contains(kl, "kubernetes.azure.com") || strings.Contains(kl, "azure.com/agentpool") {
					return ProviderAKS, nil
				}
				if strings.Contains(kl, "minikube.k8s.io") || (strings.Contains(kl, "minikube") && strings.Contains(strings.ToLower(v), "minikube")) {
					return ProviderMinikube, nil
				}
				if k == "node.kubernetes.io/instance-type" && v == "k3s" {
					return ProviderK3s, nil
				}
			}
			// Kind: node hostname often contains "control-plane" or "kind"
			if hostname, ok := n.Labels["kubernetes.io/hostname"]; ok {
				hl := strings.ToLower(hostname)
				if strings.Contains(hl, "kind") {
					return ProviderKind, nil
				}
				if strings.Contains(hl, "control-plane") && strings.Contains(contextName, "kind") {
					return ProviderKind, nil
				}
			}
		}
	}

	// 4. k3s: check for k3s-specific node label or server
	if strings.Contains(serverURL, "k3s") {
		return ProviderK3s, nil
	}

	// 5. OpenShift / Rancher: check namespaces
	nsList, err := c.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, ns := range nsList.Items {
			if strings.HasPrefix(ns.Name, "openshift") {
				return ProviderOpenShift, nil
			}
			if ns.Name == "cattle-system" || ns.Name == "cattle-fleet-system" || strings.HasPrefix(ns.Name, "rancher") {
				return ProviderRancher, nil
			}
		}
	}

	// 7. Kind: localhost/127.0.0.1 with "kind" in context
	if (strings.Contains(serverURL, "127.0.0.1") || strings.Contains(serverURL, "localhost")) && strings.Contains(contextName, "kind") {
		return ProviderKind, nil
	}

	// 8. Minikube: node label minikube.k8s.io/version (checked above) or localhost + minikube context
	if (strings.Contains(serverURL, "127.0.0.1") || strings.Contains(serverURL, "localhost")) && strings.Contains(contextName, "minikube") {
		return ProviderMinikube, nil
	}

	return ProviderOnPrem, nil
}
