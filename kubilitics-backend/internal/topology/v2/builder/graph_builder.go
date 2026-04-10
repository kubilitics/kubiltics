package builder

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/relationships"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var defaultRegistry = relationships.NewDefaultRegistry()

// BuildGraph builds a TopologyResponse from a ResourceBundle using the default relationship registry.
func BuildGraph(ctx context.Context, opts v2.Options, bundle *v2.ResourceBundle) (*v2.TopologyResponse, error) {
	if bundle == nil {
		return nil, fmt.Errorf("resource bundle is required to build topology graph")
	}
	start := time.Now()
	nodes := NodesFromBundle(bundle)
	edges, err := defaultRegistry.MatchAll(ctx, bundle)
	if err != nil {
		return nil, err
	}
	groups := groupsFromBundle(bundle)

	// Propagate health from Pods up the ownership chain so controllers
	// (ReplicaSet, Deployment, StatefulSet, DaemonSet, Job, CronJob) get
	// accurate status BEFORE the response reaches the frontend or any
	// post-render enricher.
	nodes = PropagateHealth(nodes, edges)

	buildMs := time.Since(start).Milliseconds()
	clusterName := opts.ClusterName
	if clusterName == "" {
		clusterName = opts.ClusterID
	}
	return &v2.TopologyResponse{
		Metadata: v2.TopologyMetadata{
			ClusterID:       opts.ClusterID,
			ClusterName:     clusterName,
			Mode:            opts.Mode,
			Namespace:       opts.Namespace,
			FocusResource:   opts.Resource,
			ResourceCount:   len(nodes),
			EdgeCount:       len(edges),
			BuildTimeMs:     buildMs,
			FailedResources: bundle.FailedResources,
		},
		Nodes:  nodes,
		Edges:  edges,
		Groups: groups,
	}, nil
}

// NodesFromBundle converts a ResourceBundle into a flat slice of TopologyNodes.
func NodesFromBundle(b *v2.ResourceBundle) []v2.TopologyNode {
	var out []v2.TopologyNode
	for i := range b.Pods {
		p := &b.Pods[i]
		status := "unknown"
		if p.DeletionTimestamp != nil {
			status = "terminating"
		} else if p.Status.Phase != "" {
			status = string(p.Status.Phase)
		}
		extra := make(map[string]interface{})
		// Conditions
		if len(p.Status.Conditions) > 0 {
			conds := make([]map[string]string, 0, len(p.Status.Conditions))
			for _, c := range p.Status.Conditions {
				conds = append(conds, map[string]string{
					"type":   string(c.Type),
					"status": string(c.Status),
					"reason": c.Reason,
				})
			}
			extra["conditions"] = conds
		}
		// ContainerStatuses
		if len(p.Status.ContainerStatuses) > 0 {
			cs := make([]map[string]interface{}, 0, len(p.Status.ContainerStatuses))
			for _, c := range p.Status.ContainerStatuses {
				state := "unknown"
				if c.State.Running != nil {
					state = "running"
				} else if c.State.Waiting != nil {
					state = fmt.Sprintf("waiting:%s", c.State.Waiting.Reason)
				} else if c.State.Terminated != nil {
					state = fmt.Sprintf("terminated:%s", c.State.Terminated.Reason)
				}
				cs = append(cs, map[string]interface{}{
					"name":         c.Name,
					"ready":        c.Ready,
					"restartCount": c.RestartCount,
					"state":        state,
				})
			}
			extra["containerStatuses"] = cs
		}
		// QoS class
		if p.Status.QOSClass != "" {
			extra["qosClass"] = string(p.Status.QOSClass)
		}
		// Resource requests/limits from first container
		if len(p.Spec.Containers) > 0 {
			c0 := p.Spec.Containers[0]
			if len(c0.Resources.Requests) > 0 {
				reqs := make(map[string]string)
				for k, v := range c0.Resources.Requests {
					reqs[string(k)] = v.String()
				}
				extra["resourceRequests"] = reqs
			}
			if len(c0.Resources.Limits) > 0 {
				lims := make(map[string]string)
				for k, v := range c0.Resources.Limits {
					lims[string(k)] = v.String()
				}
				extra["resourceLimits"] = lims
			}
		}
		out = append(out, v2.TopologyNode{
			ID: v2.NodeID("Pod", p.Namespace, p.Name), Kind: "Pod", Name: p.Name, Namespace: p.Namespace, APIVersion: "v1",
			Category: "workload", Label: p.Name, Status: status, Layer: 4, Group: groupIDForNamespace(p.Namespace),
			Labels: p.Labels, Annotations: stripHeavyAnnotations(p.Annotations), CreatedAt: formatTime(p.CreationTimestamp),
			PodIP: p.Status.PodIP, NodeName: p.Spec.NodeName, Containers: len(p.Spec.Containers),
			Extra: extra,
		})
	}
	for i := range b.Deployments {
		d := &b.Deployments[i]
		status := "healthy"
		if d.Status.UnavailableReplicas > 0 {
			status = "degraded"
		} else if d.Spec.Replicas != nil && d.Status.AvailableReplicas != *d.Spec.Replicas {
			status = "progressing"
		}
		out = append(out, v2.TopologyNode{
			ID: v2.NodeID("Deployment", d.Namespace, d.Name), Kind: "Deployment", Name: d.Name, Namespace: d.Namespace, APIVersion: "apps/v1",
			Category: "workload", Label: d.Name, Status: status, Layer: 2, Group: groupIDForNamespace(d.Namespace),
			Labels: d.Labels, Annotations: stripHeavyAnnotations(d.Annotations), CreatedAt: formatTime(d.CreationTimestamp),
		})
	}
	for i := range b.ReplicaSets {
		rs := &b.ReplicaSets[i]
		rsStatus := "healthy"
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}
		if desired > 0 && rs.Status.ReadyReplicas == 0 {
			rsStatus = "degraded"
		} else if desired > 0 && rs.Status.ReadyReplicas < desired {
			rsStatus = "progressing"
		}
		out = append(out, v2.TopologyNode{
			ID: v2.NodeID("ReplicaSet", rs.Namespace, rs.Name), Kind: "ReplicaSet", Name: rs.Name, Namespace: rs.Namespace, APIVersion: "apps/v1",
			Category: "workload", Label: rs.Name, Status: rsStatus, Layer: 3, Group: groupIDForNamespace(rs.Namespace),
			Labels: rs.Labels, Annotations: stripHeavyAnnotations(rs.Annotations), CreatedAt: formatTime(rs.CreationTimestamp),
		})
	}
	for i := range b.StatefulSets {
		s := &b.StatefulSets[i]
		status := "healthy"
		if s.Spec.Replicas != nil && s.Status.ReadyReplicas != *s.Spec.Replicas {
			status = "progressing"
		}
		if s.Spec.Replicas != nil && s.Status.ReadyReplicas == 0 && *s.Spec.Replicas > 0 {
			status = "degraded"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("StatefulSet", s.Namespace, s.Name), Kind: "StatefulSet", Name: s.Name, Namespace: s.Namespace, APIVersion: "apps/v1", Category: "workload", Label: s.Name, Status: status, Layer: 2, Group: groupIDForNamespace(s.Namespace), Labels: s.Labels, Annotations: stripHeavyAnnotations(s.Annotations), CreatedAt: formatTime(s.CreationTimestamp)})
	}
	for i := range b.DaemonSets {
		ds := &b.DaemonSets[i]
		status := "healthy"
		if ds.Status.NumberReady != ds.Status.DesiredNumberScheduled {
			status = "progressing"
		}
		if ds.Status.DesiredNumberScheduled > 0 && ds.Status.NumberReady == 0 {
			status = "degraded"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("DaemonSet", ds.Namespace, ds.Name), Kind: "DaemonSet", Name: ds.Name, Namespace: ds.Namespace, APIVersion: "apps/v1", Category: "workload", Label: ds.Name, Status: status, Layer: 2, Group: groupIDForNamespace(ds.Namespace), Labels: ds.Labels, Annotations: stripHeavyAnnotations(ds.Annotations), CreatedAt: formatTime(ds.CreationTimestamp)})
	}
	for i := range b.Jobs {
		j := &b.Jobs[i]
		jobStatus := "healthy"
		if j.Status.Failed > 0 {
			jobStatus = "degraded"
		} else if j.Status.Active > 0 {
			jobStatus = "progressing"
		} else if j.Status.Succeeded > 0 {
			jobStatus = "healthy"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Job", j.Namespace, j.Name), Kind: "Job", Name: j.Name, Namespace: j.Namespace, APIVersion: "batch/v1", Category: "workload", Label: j.Name, Status: jobStatus, Layer: 3, Group: groupIDForNamespace(j.Namespace), Labels: j.Labels, Annotations: stripHeavyAnnotations(j.Annotations), CreatedAt: formatTime(j.CreationTimestamp)})
	}
	for i := range b.CronJobs {
		cj := &b.CronJobs[i]
		cronStatus := "healthy"
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			cronStatus = "warning" // suspended
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("CronJob", cj.Namespace, cj.Name), Kind: "CronJob", Name: cj.Name, Namespace: cj.Namespace, APIVersion: "batch/v1", Category: "workload", Label: cj.Name, Status: cronStatus, Layer: 2, Group: groupIDForNamespace(cj.Namespace), Labels: cj.Labels, Annotations: stripHeavyAnnotations(cj.Annotations), CreatedAt: formatTime(cj.CreationTimestamp)})
	}
	// Build endpoint lookup: service name+ns → has ready addresses
	epHasAddresses := make(map[string]bool)
	for i := range b.Endpoints {
		ep := &b.Endpoints[i]
		key := ep.Namespace + "/" + ep.Name
		for _, subset := range ep.Subsets {
			if len(subset.Addresses) > 0 {
				epHasAddresses[key] = true
				break
			}
		}
		if !epHasAddresses[key] {
			epHasAddresses[key] = false // explicitly mark as no addresses
		}
	}
	for i := range b.Services {
		s := &b.Services[i]
		extra := make(map[string]interface{})
		if len(s.Spec.Ports) > 0 {
			ports := make([]map[string]interface{}, 0, len(s.Spec.Ports))
			for _, p := range s.Spec.Ports {
				ports = append(ports, map[string]interface{}{
					"port":       p.Port,
					"targetPort": p.TargetPort.String(),
					"protocol":   string(p.Protocol),
				})
			}
			extra["ports"] = ports
		}
		if s.Spec.SessionAffinity != "" {
			extra["sessionAffinity"] = string(s.Spec.SessionAffinity)
		}
		svcStatus := "healthy"
		// Services with selectors should have endpoints with ready addresses
		if len(s.Spec.Selector) > 0 {
			key := s.Namespace + "/" + s.Name
			if hasAddr, found := epHasAddresses[key]; found && !hasAddr {
				svcStatus = "warning"
			} else if !found {
				svcStatus = "warning"
			}
		}
		// ExternalName services don't have endpoints — always healthy
		if s.Spec.Type == corev1.ServiceTypeExternalName {
			svcStatus = "healthy"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Service", s.Namespace, s.Name), Kind: "Service", Name: s.Name, Namespace: s.Namespace, APIVersion: "v1", Category: "networking", Label: s.Name, Status: svcStatus, Layer: 1, Group: groupIDForNamespace(s.Namespace), Labels: s.Labels, Annotations: stripHeavyAnnotations(s.Annotations), CreatedAt: formatTime(s.CreationTimestamp), ClusterIP: s.Spec.ClusterIP, ServiceType: string(s.Spec.Type), Extra: extra})
	}
	for i := range b.Endpoints {
		e := &b.Endpoints[i]
		epStatus := "healthy"
		hasReady := false
		for _, subset := range e.Subsets {
			if len(subset.Addresses) > 0 {
				hasReady = true
				break
			}
		}
		if !hasReady && len(e.Subsets) > 0 {
			epStatus = "warning" // subsets exist but no ready addresses
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Endpoints", e.Namespace, e.Name), Kind: "Endpoints", Name: e.Name, Namespace: e.Namespace, APIVersion: "v1", Category: "networking", Label: e.Name, Status: epStatus, Layer: 1, Group: groupIDForNamespace(e.Namespace), Labels: e.Labels, Annotations: stripHeavyAnnotations(e.Annotations), CreatedAt: formatTime(e.CreationTimestamp)})
	}
	for i := range b.EndpointSlices {
		es := &b.EndpointSlices[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("EndpointSlice", es.Namespace, es.Name), Kind: "EndpointSlice", Name: es.Name, Namespace: es.Namespace, APIVersion: "discovery.k8s.io/v1", Category: "networking", Label: es.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(es.Namespace), Labels: es.Labels, Annotations: stripHeavyAnnotations(es.Annotations), CreatedAt: formatTime(es.CreationTimestamp)})
	}
	for i := range b.Ingresses {
		ing := &b.Ingresses[i]
		ingStatus := "healthy"
		// Ingress without any rules or default backend is misconfigured
		hasBackend := ing.Spec.DefaultBackend != nil
		if !hasBackend {
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP != nil && len(rule.HTTP.Paths) > 0 {
					hasBackend = true
					break
				}
			}
		}
		if !hasBackend {
			ingStatus = "warning"
		}
		// No LoadBalancer IP assigned yet → progressing
		if ingStatus == "healthy" && len(ing.Status.LoadBalancer.Ingress) == 0 {
			ingStatus = "progressing"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Ingress", ing.Namespace, ing.Name), Kind: "Ingress", Name: ing.Name, Namespace: ing.Namespace, APIVersion: "networking.k8s.io/v1", Category: "networking", Label: ing.Name, Status: ingStatus, Layer: 0, Group: groupIDForNamespace(ing.Namespace), Labels: ing.Labels, Annotations: stripHeavyAnnotations(ing.Annotations), CreatedAt: formatTime(ing.CreationTimestamp)})
	}
	for i := range b.IngressClasses {
		ic := &b.IngressClasses[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("IngressClass", "", ic.Name), Kind: "IngressClass", Name: ic.Name, Namespace: "", APIVersion: "networking.k8s.io/v1", Category: "networking", Label: ic.Name, Status: "healthy", Layer: 0, Labels: ic.Labels, Annotations: stripHeavyAnnotations(ic.Annotations), CreatedAt: formatTime(ic.CreationTimestamp)})
	}
	for i := range b.ConfigMaps {
		c := &b.ConfigMaps[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ConfigMap", c.Namespace, c.Name), Kind: "ConfigMap", Name: c.Name, Namespace: c.Namespace, APIVersion: "v1", Category: "configuration", Label: c.Name, Status: "healthy", Layer: 2, Group: groupIDForNamespace(c.Namespace), Labels: c.Labels, Annotations: stripHeavyAnnotations(c.Annotations), CreatedAt: formatTime(c.CreationTimestamp)})
	}
	for i := range b.Secrets {
		s := &b.Secrets[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Secret", s.Namespace, s.Name), Kind: "Secret", Name: s.Name, Namespace: s.Namespace, APIVersion: "v1", Category: "configuration", Label: s.Name, Status: "healthy", Layer: 2, Group: groupIDForNamespace(s.Namespace), Labels: s.Labels, Annotations: stripHeavyAnnotations(s.Annotations), CreatedAt: formatTime(s.CreationTimestamp)})
	}
	for i := range b.PVCs {
		pvc := &b.PVCs[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("PersistentVolumeClaim", pvc.Namespace, pvc.Name), Kind: "PersistentVolumeClaim", Name: pvc.Name, Namespace: pvc.Namespace, APIVersion: "v1", Category: "storage", Label: pvc.Name, Status: string(pvc.Status.Phase), Layer: 2, Group: groupIDForNamespace(pvc.Namespace), Labels: pvc.Labels, Annotations: stripHeavyAnnotations(pvc.Annotations), CreatedAt: formatTime(pvc.CreationTimestamp)})
	}
	for i := range b.PVs {
		pv := &b.PVs[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("PersistentVolume", "", pv.Name), Kind: "PersistentVolume", Name: pv.Name, Namespace: "", APIVersion: "v1", Category: "storage", Label: pv.Name, Status: string(pv.Status.Phase), Layer: 2, Labels: pv.Labels, Annotations: stripHeavyAnnotations(pv.Annotations), CreatedAt: formatTime(pv.CreationTimestamp)})
	}
	for i := range b.StorageClasses {
		sc := &b.StorageClasses[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("StorageClass", "", sc.Name), Kind: "StorageClass", Name: sc.Name, Namespace: "", APIVersion: "storage.k8s.io/v1", Category: "storage", Label: sc.Name, Status: "healthy", Layer: 0, Labels: sc.Labels, Annotations: stripHeavyAnnotations(sc.Annotations), CreatedAt: formatTime(sc.CreationTimestamp)})
	}
	for i := range b.Nodes {
		n := &b.Nodes[i]
		status := "Unknown"
		for _, c := range n.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				status = "Ready"
				break
			}
		}
		internalIP, externalIP := nodeAddresses(n)
		extra := make(map[string]interface{})
		// All node conditions
		if len(n.Status.Conditions) > 0 {
			conds := make([]map[string]string, 0, len(n.Status.Conditions))
			for _, c := range n.Status.Conditions {
				conds = append(conds, map[string]string{
					"type":   string(c.Type),
					"status": string(c.Status),
					"reason": c.Reason,
				})
			}
			extra["conditions"] = conds
		}
		// Allocatable resources
		alloc := make(map[string]string)
		if cpu := n.Status.Allocatable.Cpu(); cpu != nil {
			alloc["cpu"] = cpu.String()
		}
		if mem := n.Status.Allocatable.Memory(); mem != nil {
			alloc["memory"] = mem.String()
		}
		if len(alloc) > 0 {
			extra["allocatable"] = alloc
		}
		// Kubelet version
		if n.Status.NodeInfo.KubeletVersion != "" {
			extra["kubeletVersion"] = n.Status.NodeInfo.KubeletVersion
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Node", "", n.Name), Kind: "Node", Name: n.Name, Namespace: "", APIVersion: "v1", Category: "cluster", Label: n.Name, Status: status, Layer: 5, Labels: n.Labels, Annotations: stripHeavyAnnotations(n.Annotations), CreatedAt: formatTime(n.CreationTimestamp), InternalIP: internalIP, ExternalIP: externalIP, Extra: extra})
	}
	for i := range b.Namespaces {
		ns := &b.Namespaces[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Namespace", "", ns.Name), Kind: "Namespace", Name: ns.Name, Namespace: "", APIVersion: "v1", Category: "cluster", Label: ns.Name, Status: "Active", Layer: 0, Labels: ns.Labels, Annotations: stripHeavyAnnotations(ns.Annotations), CreatedAt: formatTime(ns.CreationTimestamp)})
	}
	for i := range b.ServiceAccounts {
		sa := &b.ServiceAccounts[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ServiceAccount", sa.Namespace, sa.Name), Kind: "ServiceAccount", Name: sa.Name, Namespace: sa.Namespace, APIVersion: "v1", Category: "rbac", Label: sa.Name, Status: "healthy", Layer: 2, Group: groupIDForNamespace(sa.Namespace), Labels: sa.Labels, Annotations: stripHeavyAnnotations(sa.Annotations), CreatedAt: formatTime(sa.CreationTimestamp)})
	}
	for i := range b.Roles {
		r := &b.Roles[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Role", r.Namespace, r.Name), Kind: "Role", Name: r.Name, Namespace: r.Namespace, APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: r.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(r.Namespace), Labels: r.Labels, Annotations: stripHeavyAnnotations(r.Annotations), CreatedAt: formatTime(r.CreationTimestamp)})
	}
	for i := range b.RoleBindings {
		rb := &b.RoleBindings[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("RoleBinding", rb.Namespace, rb.Name), Kind: "RoleBinding", Name: rb.Name, Namespace: rb.Namespace, APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: rb.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(rb.Namespace), Labels: rb.Labels, Annotations: stripHeavyAnnotations(rb.Annotations), CreatedAt: formatTime(rb.CreationTimestamp)})
	}
	for i := range b.ClusterRoles {
		cr := &b.ClusterRoles[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ClusterRole", "", cr.Name), Kind: "ClusterRole", Name: cr.Name, Namespace: "", APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: cr.Name, Status: "healthy", Layer: 0, Labels: cr.Labels, Annotations: stripHeavyAnnotations(cr.Annotations), CreatedAt: formatTime(cr.CreationTimestamp)})
	}
	for i := range b.ClusterRoleBindings {
		crb := &b.ClusterRoleBindings[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ClusterRoleBinding", "", crb.Name), Kind: "ClusterRoleBinding", Name: crb.Name, Namespace: "", APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: crb.Name, Status: "healthy", Layer: 0, Labels: crb.Labels, Annotations: stripHeavyAnnotations(crb.Annotations), CreatedAt: formatTime(crb.CreationTimestamp)})
	}
	for i := range b.HPAs {
		h := &b.HPAs[i]
		hpaStatus := "healthy"
		// Check if HPA is at max replicas (capacity pressure)
		if h.Status.CurrentReplicas >= h.Spec.MaxReplicas && h.Spec.MaxReplicas > 0 {
			hpaStatus = "warning"
		}
		// Check if current replicas is 0 when min > 0 (not scaling)
		if h.Spec.MinReplicas != nil && *h.Spec.MinReplicas > 0 && h.Status.CurrentReplicas == 0 {
			hpaStatus = "degraded"
		}
		// Check conditions for ScalingLimited or AbleToScale=False
		for _, cond := range h.Status.Conditions {
			if cond.Type == "ScalingLimited" && cond.Status == "True" {
				hpaStatus = "warning"
			}
			if cond.Type == "AbleToScale" && cond.Status == "False" {
				hpaStatus = "degraded"
			}
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("HorizontalPodAutoscaler", h.Namespace, h.Name), Kind: "HorizontalPodAutoscaler", Name: h.Name, Namespace: h.Namespace, APIVersion: "autoscaling/v2", Category: "scaling", Label: h.Name, Status: hpaStatus, Layer: 1, Group: groupIDForNamespace(h.Namespace), Labels: h.Labels, Annotations: stripHeavyAnnotations(h.Annotations), CreatedAt: formatTime(h.CreationTimestamp)})
	}
	for i := range b.PDBs {
		pdb := &b.PDBs[i]
		pdbStatus := "healthy"
		// If expected pods > 0 but current healthy < expected → warning
		if pdb.Status.ExpectedPods > 0 && pdb.Status.CurrentHealthy < pdb.Status.ExpectedPods {
			pdbStatus = "warning"
		}
		// If disruptions allowed is 0 and there are expected pods → budget exhausted
		if pdb.Status.DisruptionsAllowed == 0 && pdb.Status.ExpectedPods > 0 {
			pdbStatus = "warning"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("PodDisruptionBudget", pdb.Namespace, pdb.Name), Kind: "PodDisruptionBudget", Name: pdb.Name, Namespace: pdb.Namespace, APIVersion: "policy/v1", Category: "policy", Label: pdb.Name, Status: pdbStatus, Layer: 1, Group: groupIDForNamespace(pdb.Namespace), Labels: pdb.Labels, Annotations: stripHeavyAnnotations(pdb.Annotations), CreatedAt: formatTime(pdb.CreationTimestamp)})
	}
	for i := range b.NetworkPolicies {
		np := &b.NetworkPolicies[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("NetworkPolicy", np.Namespace, np.Name), Kind: "NetworkPolicy", Name: np.Name, Namespace: np.Namespace, APIVersion: "networking.k8s.io/v1", Category: "policy", Label: np.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(np.Namespace), Labels: np.Labels, Annotations: stripHeavyAnnotations(np.Annotations), CreatedAt: formatTime(np.CreationTimestamp)})
	}
	for i := range b.MutatingWebhooks {
		w := &b.MutatingWebhooks[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("MutatingWebhookConfiguration", "", w.Name), Kind: "MutatingWebhookConfiguration", Name: w.Name, Namespace: "", APIVersion: "admissionregistration.k8s.io/v1", Category: "policy", Label: w.Name, Status: "healthy", Layer: 0, Labels: w.Labels, Annotations: stripHeavyAnnotations(w.Annotations), CreatedAt: formatTime(w.CreationTimestamp)})
	}
	for i := range b.ValidatingWebhooks {
		w := &b.ValidatingWebhooks[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ValidatingWebhookConfiguration", "", w.Name), Kind: "ValidatingWebhookConfiguration", Name: w.Name, Namespace: "", APIVersion: "admissionregistration.k8s.io/v1", Category: "policy", Label: w.Name, Status: "healthy", Layer: 0, Labels: w.Labels, Annotations: stripHeavyAnnotations(w.Annotations), CreatedAt: formatTime(w.CreationTimestamp)})
	}
	for i := range b.Events {
		ev := &b.Events[i]
		status := "healthy"
		if ev.Type == "Warning" {
			status = "warning"
		}
		out = append(out, v2.TopologyNode{ID: v2.NodeID("Event", ev.Namespace, ev.Name), Kind: "Event", Name: ev.Name, Namespace: ev.Namespace, APIVersion: "v1", Category: "cluster", Label: ev.Reason, Status: status, Layer: 5, Group: groupIDForNamespace(ev.Namespace), Labels: ev.Labels, Annotations: stripHeavyAnnotations(ev.Annotations), CreatedAt: formatTime(ev.CreationTimestamp)})
	}
	for i := range b.ResourceQuotas {
		rq := &b.ResourceQuotas[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("ResourceQuota", rq.Namespace, rq.Name), Kind: "ResourceQuota", Name: rq.Name, Namespace: rq.Namespace, APIVersion: "v1", Category: "policy", Label: rq.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(rq.Namespace), Labels: rq.Labels, Annotations: stripHeavyAnnotations(rq.Annotations), CreatedAt: formatTime(rq.CreationTimestamp)})
	}
	for i := range b.LimitRanges {
		lr := &b.LimitRanges[i]
		out = append(out, v2.TopologyNode{ID: v2.NodeID("LimitRange", lr.Namespace, lr.Name), Kind: "LimitRange", Name: lr.Name, Namespace: lr.Namespace, APIVersion: "v1", Category: "policy", Label: lr.Name, Status: "healthy", Layer: 1, Group: groupIDForNamespace(lr.Namespace), Labels: lr.Labels, Annotations: stripHeavyAnnotations(lr.Annotations), CreatedAt: formatTime(lr.CreationTimestamp)})
	}
	// Synthetic User and Group nodes from RBAC bindings (external identities, not K8s resources).
	seenSubjects := make(map[string]bool)
	for i := range b.RoleBindings {
		for _, subj := range b.RoleBindings[i].Subjects {
			if subj.Kind == "User" || subj.Kind == "Group" {
				id := v2.NodeID(subj.Kind, subj.Namespace, subj.Name)
				if !seenSubjects[id] {
					seenSubjects[id] = true
					out = append(out, v2.TopologyNode{ID: id, Kind: subj.Kind, Name: subj.Name, Namespace: subj.Namespace, APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: subj.Name, Status: "healthy", Layer: 2, Group: groupIDForNamespace(subj.Namespace)})
				}
			}
		}
	}
	for i := range b.ClusterRoleBindings {
		for _, subj := range b.ClusterRoleBindings[i].Subjects {
			if subj.Kind == "User" || subj.Kind == "Group" {
				id := v2.NodeID(subj.Kind, "", subj.Name)
				if !seenSubjects[id] {
					seenSubjects[id] = true
					out = append(out, v2.TopologyNode{ID: id, Kind: subj.Kind, Name: subj.Name, Namespace: "", APIVersion: "rbac.authorization.k8s.io/v1", Category: "rbac", Label: subj.Name, Status: "healthy", Layer: 2})
				}
			}
		}
	}
	return out
}

func groupIDForNamespace(ns string) string {
	if ns == "" {
		return ""
	}
	return "group-ns-" + ns
}

func groupsFromBundle(b *v2.ResourceBundle) []v2.TopologyGroup {
	seen := make(map[string]bool)
	for _, n := range b.Namespaces {
		id := groupIDForNamespace(n.Name)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
	}
	var out []v2.TopologyGroup
	for ns := range seen {
		namespaceName := strings.TrimPrefix(ns, "group-ns-")
		var members []string
		for i := range b.Pods {
			if b.Pods[i].Namespace == namespaceName {
				members = append(members, v2.NodeID("Pod", b.Pods[i].Namespace, b.Pods[i].Name))
			}
		}
		for i := range b.Deployments {
			if b.Deployments[i].Namespace == namespaceName {
				members = append(members, v2.NodeID("Deployment", b.Deployments[i].Namespace, b.Deployments[i].Name))
			}
		}
		for i := range b.Services {
			if b.Services[i].Namespace == namespaceName {
				members = append(members, v2.NodeID("Service", b.Services[i].Namespace, b.Services[i].Name))
			}
		}
		out = append(out, v2.TopologyGroup{
			ID: ns, Label: namespaceName, Type: "namespace", Members: members, Collapsed: false,
			Style: v2.GroupStyle{BackgroundColor: "#f1f5f9", BorderColor: "#94a3b8"},
		})
	}
	return out
}

func formatTime(t metav1.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// nodeAddresses extracts InternalIP and ExternalIP from a Node's status.
func nodeAddresses(n *corev1.Node) (internalIP, externalIP string) {
	for _, addr := range n.Status.Addresses {
		switch addr.Type {
		case corev1.NodeInternalIP:
			if internalIP == "" {
				internalIP = addr.Address
			}
		case corev1.NodeExternalIP:
			if externalIP == "" {
				externalIP = addr.Address
			}
		}
	}
	return
}

// stripHeavyAnnotations removes large annotations (like kubectl last-applied-config)
// from topology nodes to reduce JSON payload size. Topology nodes don't need the
// full resource YAML embedded in annotations.
func stripHeavyAnnotations(ann map[string]string) map[string]string {
	if len(ann) == 0 {
		return nil
	}
	clean := make(map[string]string, len(ann))
	for k, v := range ann {
		// Skip annotations that embed full resource YAML (10KB+ each)
		if k == "kubectl.kubernetes.io/last-applied-configuration" {
			continue
		}
		if k == "control-plane.alpha.kubernetes.io/leader" {
			continue
		}
		// Skip any annotation value > 500 bytes (topology doesn't need long values)
		if len(v) > 500 {
			continue
		}
		clean[k] = v
	}
	if len(clean) == 0 {
		return nil
	}
	return clean
}
