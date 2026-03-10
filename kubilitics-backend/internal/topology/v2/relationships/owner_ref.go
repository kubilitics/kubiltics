package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// OwnerRefMatcher produces edges from metadata.ownerReferences (Pod→RS→Deployment, Pod→StatefulSet/DaemonSet/Job, Job→CronJob).
type OwnerRefMatcher struct{}

func (OwnerRefMatcher) Name() string { return "owner_ref" }

func (m *OwnerRefMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	// ReplicaSet → Deployment
	for i := range bundle.ReplicaSets {
		rs := &bundle.ReplicaSets[i]
		for _, ref := range rs.OwnerReferences {
			if ref.Kind != "Deployment" || ref.Controller == nil || !*ref.Controller {
				continue
			}
			if !hasDeployment(bundle, rs.Namespace, ref.Name) {
				continue
			}
			src := v2.NodeID("ReplicaSet", rs.Namespace, rs.Name)
			tgt := v2.NodeID("Deployment", rs.Namespace, ref.Name)
			edges = append(edges, makeOwnershipEdge(src, tgt, "owned by"))
		}
	}

	// Pod → ReplicaSet, StatefulSet, DaemonSet, Job
	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		for _, ref := range pod.OwnerReferences {
			if ref.Controller == nil || !*ref.Controller {
				continue
			}
			ns := pod.Namespace
			src := v2.NodeID("Pod", pod.Namespace, pod.Name)
			var tgt string
			var found bool
			switch ref.Kind {
			case "ReplicaSet":
				tgt = v2.NodeID("ReplicaSet", ns, ref.Name)
				found = hasReplicaSet(bundle, ns, ref.Name)
			case "StatefulSet":
				tgt = v2.NodeID("StatefulSet", ns, ref.Name)
				found = hasStatefulSet(bundle, ns, ref.Name)
			case "DaemonSet":
				tgt = v2.NodeID("DaemonSet", ns, ref.Name)
				found = hasDaemonSet(bundle, ns, ref.Name)
			case "Job":
				tgt = v2.NodeID("Job", ns, ref.Name)
				found = hasJob(bundle, ns, ref.Name)
			default:
				continue
			}
			if found {
				edges = append(edges, makeOwnershipEdge(src, tgt, "owned by"))
			}
		}
	}

	// Job → CronJob
	for i := range bundle.Jobs {
		job := &bundle.Jobs[i]
		for _, ref := range job.OwnerReferences {
			if ref.Kind != "CronJob" || ref.Controller == nil || !*ref.Controller {
				continue
			}
			ns := job.Namespace
			if !hasCronJob(bundle, ns, ref.Name) {
				continue
			}
			src := v2.NodeID("Job", job.Namespace, job.Name)
			tgt := v2.NodeID("CronJob", ns, ref.Name)
			edges = append(edges, makeOwnershipEdge(src, tgt, "owned by"))
		}
	}

	return edges, nil
}

func makeOwnershipEdge(source, target, label string) v2.TopologyEdge {
	return v2.TopologyEdge{
		ID:                   v2.EdgeID(source, target, "ownerRef"),
		Source:               source,
		Target:               target,
		RelationshipType:     "ownerRef",
		RelationshipCategory: "ownership",
		Label:                label,
		Detail:               "metadata.ownerReferences",
		Style:                "solid",
		Healthy:              true,
	}
}

func hasDeployment(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.Deployments {
		if b.Deployments[i].Namespace == ns && b.Deployments[i].Name == name {
			return true
		}
	}
	return false
}

func hasReplicaSet(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.ReplicaSets {
		if b.ReplicaSets[i].Namespace == ns && b.ReplicaSets[i].Name == name {
			return true
		}
	}
	return false
}

func hasStatefulSet(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.StatefulSets {
		if b.StatefulSets[i].Namespace == ns && b.StatefulSets[i].Name == name {
			return true
		}
	}
	return false
}

func hasDaemonSet(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.DaemonSets {
		if b.DaemonSets[i].Namespace == ns && b.DaemonSets[i].Name == name {
			return true
		}
	}
	return false
}

func hasJob(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.Jobs {
		if b.Jobs[i].Namespace == ns && b.Jobs[i].Name == name {
			return true
		}
	}
	return false
}

func hasCronJob(b *v2.ResourceBundle, ns, name string) bool {
	for i := range b.CronJobs {
		if b.CronJobs[i].Namespace == ns && b.CronJobs[i].Name == name {
			return true
		}
	}
	return false
}
