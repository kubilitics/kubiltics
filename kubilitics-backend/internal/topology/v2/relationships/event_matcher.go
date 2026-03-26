package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// EventMatcher produces edges from Events to their involvedObject (e.g., Event→Pod, Event→Node).
type EventMatcher struct{}

func (EventMatcher) Name() string { return "event" }

func (m *EventMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	for i := range bundle.Events {
		ev := &bundle.Events[i]
		kind := ev.InvolvedObject.Kind
		ns := ev.InvolvedObject.Namespace
		name := ev.InvolvedObject.Name
		if kind == "" || name == "" {
			continue
		}
		if !hasResource(bundle, kind, ns, name) {
			continue
		}
		src := v2.NodeID("Event", ev.Namespace, ev.Name)
		tgt := v2.NodeID(kind, ns, name)
		id := v2.EdgeID(src, tgt, "event")
		if seen[id] {
			continue
		}
		seen[id] = true
		edges = append(edges, v2.TopologyEdge{
			ID:                   id,
			Source:               src,
			Target:               tgt,
			RelationshipType:     "event",
			RelationshipCategory: "cluster",
			Label:                ev.Reason,
			Detail:               "involvedObject",
			Style:                "dotted",
			Healthy:              true,
		})
	}
	return edges, nil
}

// hasResource checks whether a resource of the given kind/namespace/name exists in the bundle.
func hasResource(b *v2.ResourceBundle, kind, ns, name string) bool {
	switch kind {
	case "Pod":
		for i := range b.Pods {
			if b.Pods[i].Namespace == ns && b.Pods[i].Name == name {
				return true
			}
		}
	case "Node":
		for i := range b.Nodes {
			if b.Nodes[i].Name == name {
				return true
			}
		}
	case "Deployment":
		return hasDeployment(b, ns, name)
	case "ReplicaSet":
		return hasReplicaSet(b, ns, name)
	case "StatefulSet":
		return hasStatefulSet(b, ns, name)
	case "DaemonSet":
		return hasDaemonSet(b, ns, name)
	case "Job":
		return hasJob(b, ns, name)
	case "CronJob":
		return hasCronJob(b, ns, name)
	case "Service":
		for i := range b.Services {
			if b.Services[i].Namespace == ns && b.Services[i].Name == name {
				return true
			}
		}
	case "ConfigMap":
		for i := range b.ConfigMaps {
			if b.ConfigMaps[i].Namespace == ns && b.ConfigMaps[i].Name == name {
				return true
			}
		}
	case "Secret":
		for i := range b.Secrets {
			if b.Secrets[i].Namespace == ns && b.Secrets[i].Name == name {
				return true
			}
		}
	case "PersistentVolumeClaim":
		for i := range b.PVCs {
			if b.PVCs[i].Namespace == ns && b.PVCs[i].Name == name {
				return true
			}
		}
	case "Ingress":
		for i := range b.Ingresses {
			if b.Ingresses[i].Namespace == ns && b.Ingresses[i].Name == name {
				return true
			}
		}
	case "Namespace":
		for i := range b.Namespaces {
			if b.Namespaces[i].Name == name {
				return true
			}
		}
	}
	return false
}
