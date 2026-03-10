package v2

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

// MetricsEnricher attaches CPU/memory metrics to nodes when IncludeMetrics is true.
// It extracts requests/limits from pod specs and aggregates for workload controllers.
type MetricsEnricher struct{}

// EnrichNodes populates the Metrics field on each node from the ResourceBundle.
func (m *MetricsEnricher) EnrichNodes(nodes []TopologyNode, bundle *ResourceBundle) {
	if bundle == nil {
		return
	}
	podMetrics := make(map[string]*NodeMetrics, len(bundle.Pods))
	for i := range bundle.Pods {
		p := &bundle.Pods[i]
		id := NodeID("Pod", p.Namespace, p.Name)
		pm := computePodMetrics(p)
		podMetrics[id] = pm
	}

	// Build workload → pods mapping for aggregation
	workloadPods := make(map[string][]string)
	for i := range bundle.Pods {
		p := &bundle.Pods[i]
		podID := NodeID("Pod", p.Namespace, p.Name)
		for _, ref := range p.OwnerReferences {
			if ref.Controller != nil && *ref.Controller {
				ownerID := NodeID(ref.Kind, p.Namespace, ref.Name)
				workloadPods[ownerID] = append(workloadPods[ownerID], podID)
			}
		}
	}

	// RS → Deployment mapping
	rsDeployment := make(map[string]string)
	for i := range bundle.ReplicaSets {
		rs := &bundle.ReplicaSets[i]
		rsID := NodeID("ReplicaSet", rs.Namespace, rs.Name)
		for _, ref := range rs.OwnerReferences {
			if ref.Kind == "Deployment" && ref.Controller != nil && *ref.Controller {
				depID := NodeID("Deployment", rs.Namespace, ref.Name)
				rsDeployment[rsID] = depID
			}
		}
	}

	for i := range nodes {
		n := &nodes[i]
		switch n.Kind {
		case "Pod":
			if pm, ok := podMetrics[n.ID]; ok {
				n.Metrics = pm
			}
		case "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob":
			n.Metrics = aggregateWorkloadMetrics(n.ID, workloadPods, rsDeployment, podMetrics)
		case "Node":
			n.Metrics = computeNodeMetrics(n, bundle, podMetrics)
		}
	}
}

func computePodMetrics(pod *corev1.Pod) *NodeMetrics {
	var cpuReq, cpuLim, memReq, memLim int64
	for _, c := range pod.Spec.Containers {
		cpuReq += quantityToMillis(c.Resources.Requests.Cpu())
		cpuLim += quantityToMillis(c.Resources.Limits.Cpu())
		memReq += quantityToBytes(c.Resources.Requests.Memory())
		memLim += quantityToBytes(c.Resources.Limits.Memory())
	}
	var restarts int64
	for _, cs := range pod.Status.ContainerStatuses {
		restarts += int64(cs.RestartCount)
	}
	return &NodeMetrics{
		CPURequest:   &cpuReq,
		CPULimit:     &cpuLim,
		MemoryRequest: &memReq,
		MemoryLimit:   &memLim,
		RestartCount:  &restarts,
	}
}

func aggregateWorkloadMetrics(workloadID string, workloadPods map[string][]string, rsDeployment map[string]string, podMetrics map[string]*NodeMetrics) *NodeMetrics {
	var podIDs []string

	// Direct pods
	if pods, ok := workloadPods[workloadID]; ok {
		podIDs = append(podIDs, pods...)
	}

	// For Deployments, also collect pods through ReplicaSets
	for rsID, depID := range rsDeployment {
		if depID == workloadID {
			if pods, ok := workloadPods[rsID]; ok {
				podIDs = append(podIDs, pods...)
			}
		}
	}

	if len(podIDs) == 0 {
		return nil
	}

	var cpuReq, cpuLim, memReq, memLim, restarts int64
	podCount := int64(len(podIDs))
	readyCount := int64(0)

	for _, pid := range podIDs {
		pm, ok := podMetrics[pid]
		if !ok || pm == nil {
			continue
		}
		if pm.CPURequest != nil {
			cpuReq += *pm.CPURequest
		}
		if pm.CPULimit != nil {
			cpuLim += *pm.CPULimit
		}
		if pm.MemoryRequest != nil {
			memReq += *pm.MemoryRequest
		}
		if pm.MemoryLimit != nil {
			memLim += *pm.MemoryLimit
		}
		if pm.RestartCount != nil {
			restarts += *pm.RestartCount
		}
		readyCount++
	}

	return &NodeMetrics{
		CPURequest:   &cpuReq,
		CPULimit:     &cpuLim,
		MemoryRequest: &memReq,
		MemoryLimit:   &memLim,
		RestartCount:  &restarts,
		PodCount:      &podCount,
		ReadyCount:    &readyCount,
	}
}

func computeNodeMetrics(n *TopologyNode, bundle *ResourceBundle, podMetrics map[string]*NodeMetrics) *NodeMetrics {
	var cpuReq, cpuLim, memReq, memLim int64
	var podCount, readyCount int64

	for i := range bundle.Pods {
		p := &bundle.Pods[i]
		if p.Spec.NodeName != n.Name {
			continue
		}
		podCount++
		podID := NodeID("Pod", p.Namespace, p.Name)
		pm, ok := podMetrics[podID]
		if !ok || pm == nil {
			continue
		}
		readyCount++
		if pm.CPURequest != nil {
			cpuReq += *pm.CPURequest
		}
		if pm.CPULimit != nil {
			cpuLim += *pm.CPULimit
		}
		if pm.MemoryRequest != nil {
			memReq += *pm.MemoryRequest
		}
		if pm.MemoryLimit != nil {
			memLim += *pm.MemoryLimit
		}
	}

	return &NodeMetrics{
		CPURequest:   &cpuReq,
		CPULimit:     &cpuLim,
		MemoryRequest: &memReq,
		MemoryLimit:   &memLim,
		PodCount:      &podCount,
		ReadyCount:    &readyCount,
	}
}

func quantityToMillis(q *resource.Quantity) int64 {
	if q == nil || q.IsZero() {
		return 0
	}
	return q.MilliValue()
}

func quantityToBytes(q *resource.Quantity) int64 {
	if q == nil || q.IsZero() {
		return 0
	}
	return q.Value()
}

