package v2

import (
	corev1 "k8s.io/api/core/v1"
)

// HealthEnricher computes health status and statusReason for every node based on
// live K8s resource status. Called by GraphBuilder when IncludeHealth is true.
type HealthEnricher struct{}

// HealthStatus represents the health states aligned with the frontend.
type HealthStatus string

const (
	HealthStatusHealthy HealthStatus = "healthy"
	HealthStatusWarning HealthStatus = "warning"
	HealthStatusError   HealthStatus = "error"
	HealthStatusUnknown HealthStatus = "unknown"
)

// EnrichNodes sets Status and StatusReason on each node based on the bundle state.
func (h *HealthEnricher) EnrichNodes(nodes []TopologyNode, bundle *ResourceBundle) {
	if bundle == nil {
		return
	}
	podStatus := make(map[string]podHealth, len(bundle.Pods))
	for i := range bundle.Pods {
		p := &bundle.Pods[i]
		id := NodeID("Pod", p.Namespace, p.Name)
		podStatus[id] = computePodHealth(p)
	}

	nodeStatus := make(map[string]nodeHealth, len(bundle.Nodes))
	for i := range bundle.Nodes {
		n := &bundle.Nodes[i]
		id := NodeID("Node", "", n.Name)
		nodeStatus[id] = computeNodeHealth(n)
	}

	for i := range nodes {
		n := &nodes[i]
		switch n.Kind {
		case "Pod":
			if ph, ok := podStatus[n.ID]; ok {
				n.Status = string(ph.status)
				n.StatusReason = ph.reason
			}
		case "Node":
			if nh, ok := nodeStatus[n.ID]; ok {
				n.Status = string(nh.status)
				n.StatusReason = nh.reason
			}
		case "Deployment":
			n.Status, n.StatusReason = computeDeploymentHealth(n, bundle)
		case "StatefulSet":
			n.Status, n.StatusReason = computeStatefulSetHealth(n, bundle)
		case "DaemonSet":
			n.Status, n.StatusReason = computeDaemonSetHealth(n, bundle)
		case "Service":
			n.Status = string(HealthStatusHealthy)
			n.StatusReason = "Active"
		case "PersistentVolumeClaim":
			n.Status, n.StatusReason = computePVCHealth(n, bundle)
		case "PersistentVolume":
			n.Status, n.StatusReason = computePVHealth(n, bundle)
		default:
			if n.Status == "" || n.Status == "unknown" {
				n.Status = string(HealthStatusHealthy)
				n.StatusReason = "Active"
			}
		}
	}
}

type podHealth struct {
	status HealthStatus
	reason string
}

func computePodHealth(pod *corev1.Pod) podHealth {
	switch pod.Status.Phase {
	case corev1.PodRunning:
		for _, cs := range pod.Status.ContainerStatuses {
			if !cs.Ready {
				return podHealth{HealthStatusWarning, "ContainerNotReady"}
			}
			if cs.RestartCount > 5 {
				return podHealth{HealthStatusWarning, "HighRestartCount"}
			}
		}
		return podHealth{HealthStatusHealthy, "Running"}
	case corev1.PodSucceeded:
		return podHealth{HealthStatusHealthy, "Completed"}
	case corev1.PodPending:
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodScheduled && cond.Status == corev1.ConditionFalse {
				return podHealth{HealthStatusWarning, "Unschedulable"}
			}
		}
		return podHealth{HealthStatusWarning, "Pending"}
	case corev1.PodFailed:
		reason := "Failed"
		if pod.Status.Reason != "" {
			reason = pod.Status.Reason
		}
		return podHealth{HealthStatusError, reason}
	default:
		return podHealth{HealthStatusUnknown, string(pod.Status.Phase)}
	}
}

type nodeHealth struct {
	status HealthStatus
	reason string
}

func computeNodeHealth(node *corev1.Node) nodeHealth {
	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			if cond.Status == corev1.ConditionTrue {
				return nodeHealth{HealthStatusHealthy, "Ready"}
			}
			return nodeHealth{HealthStatusError, "NotReady"}
		}
	}
	for _, cond := range node.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			switch cond.Type {
			case corev1.NodeMemoryPressure:
				return nodeHealth{HealthStatusWarning, "MemoryPressure"}
			case corev1.NodeDiskPressure:
				return nodeHealth{HealthStatusWarning, "DiskPressure"}
			case corev1.NodePIDPressure:
				return nodeHealth{HealthStatusWarning, "PIDPressure"}
			}
		}
	}
	return nodeHealth{HealthStatusUnknown, "Unknown"}
}

func computeDeploymentHealth(n *TopologyNode, bundle *ResourceBundle) (string, string) {
	for i := range bundle.Deployments {
		d := &bundle.Deployments[i]
		if d.Namespace == n.Namespace && d.Name == n.Name {
			ready := d.Status.ReadyReplicas
			desired := int32(0)
			if d.Spec.Replicas != nil {
				desired = *d.Spec.Replicas
			}
			if ready == desired && desired > 0 {
				return string(HealthStatusHealthy), "Available"
			}
			if ready == 0 && desired > 0 {
				return string(HealthStatusError), "NoReplicasReady"
			}
			return string(HealthStatusWarning), "PartiallyAvailable"
		}
	}
	return string(HealthStatusHealthy), "Active"
}

func computeStatefulSetHealth(n *TopologyNode, bundle *ResourceBundle) (string, string) {
	for i := range bundle.StatefulSets {
		s := &bundle.StatefulSets[i]
		if s.Namespace == n.Namespace && s.Name == n.Name {
			ready := s.Status.ReadyReplicas
			desired := int32(0)
			if s.Spec.Replicas != nil {
				desired = *s.Spec.Replicas
			}
			if ready == desired && desired > 0 {
				return string(HealthStatusHealthy), "Available"
			}
			if ready == 0 && desired > 0 {
				return string(HealthStatusError), "NoReplicasReady"
			}
			return string(HealthStatusWarning), "PartiallyAvailable"
		}
	}
	return string(HealthStatusHealthy), "Active"
}

func computeDaemonSetHealth(n *TopologyNode, bundle *ResourceBundle) (string, string) {
	for i := range bundle.DaemonSets {
		ds := &bundle.DaemonSets[i]
		if ds.Namespace == n.Namespace && ds.Name == n.Name {
			desired := ds.Status.DesiredNumberScheduled
			ready := ds.Status.NumberReady
			if ready == desired && desired > 0 {
				return string(HealthStatusHealthy), "Available"
			}
			if ready == 0 && desired > 0 {
				return string(HealthStatusError), "NoneReady"
			}
			return string(HealthStatusWarning), "PartiallyAvailable"
		}
	}
	return string(HealthStatusHealthy), "Active"
}

func computePVCHealth(n *TopologyNode, bundle *ResourceBundle) (string, string) {
	for i := range bundle.PVCs {
		pvc := &bundle.PVCs[i]
		if pvc.Namespace == n.Namespace && pvc.Name == n.Name {
			switch pvc.Status.Phase {
			case corev1.ClaimBound:
				return string(HealthStatusHealthy), "Bound"
			case corev1.ClaimPending:
				return string(HealthStatusWarning), "Pending"
			case corev1.ClaimLost:
				return string(HealthStatusError), "Lost"
			}
		}
	}
	return string(HealthStatusUnknown), "Unknown"
}

func computePVHealth(n *TopologyNode, bundle *ResourceBundle) (string, string) {
	for i := range bundle.PVs {
		pv := &bundle.PVs[i]
		if pv.Name == n.Name {
			switch pv.Status.Phase {
			case corev1.VolumeBound:
				return string(HealthStatusHealthy), "Bound"
			case corev1.VolumeAvailable:
				return string(HealthStatusHealthy), "Available"
			case corev1.VolumePending:
				return string(HealthStatusWarning), "Pending"
			case corev1.VolumeReleased:
				return string(HealthStatusWarning), "Released"
			case corev1.VolumeFailed:
				return string(HealthStatusError), "Failed"
			}
		}
	}
	return string(HealthStatusUnknown), "Unknown"
}

