package health

import (
	"fmt"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// scalableKinds are Kubernetes workload kinds that support horizontal scaling.
var scalableKinds = map[string]bool{
	"Deployment":  true,
	"StatefulSet": true,
	"ReplicaSet":  true,
}

// workloadKinds are Kubernetes resource kinds considered workloads for health scoring.
var workloadKinds = map[string]bool{
	"Deployment":  true,
	"StatefulSet": true,
	"DaemonSet":   true,
	"ReplicaSet":  true,
	"Job":         true,
	"CronJob":     true,
	"Service":     true,
}

// SnapshotAdapter adapts a graph.GraphSnapshot to the ClusterData interface.
type SnapshotAdapter struct {
	snap *graph.GraphSnapshot
}

// NewSnapshotAdapter creates a ClusterData adapter from a GraphSnapshot.
func NewSnapshotAdapter(snap *graph.GraphSnapshot) *SnapshotAdapter {
	return &SnapshotAdapter{snap: snap}
}

// GetNamespaces returns sorted namespace names from the snapshot.
func (a *SnapshotAdapter) GetNamespaces() []string {
	ns := make([]string, 0, len(a.snap.Namespaces))
	for n := range a.snap.Namespaces {
		ns = append(ns, n)
	}
	sort.Strings(ns)
	return ns
}

// GetWorkloadsInNamespace returns workload info for all workloads in the given namespace.
func (a *SnapshotAdapter) GetWorkloadsInNamespace(ns string) []WorkloadInfo {
	var workloads []WorkloadInfo

	for key, ref := range a.snap.Nodes {
		if ref.Namespace != ns {
			continue
		}
		if !workloadKinds[ref.Kind] {
			continue
		}

		replicas := a.snap.NodeReplicas[key]
		hasHPA := a.snap.NodeHasHPA[key]
		hasPDB := a.snap.NodeHasPDB[key]
		fanIn := len(a.snap.Reverse[key])
		isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

		workloads = append(workloads, WorkloadInfo{
			Key:        key,
			Kind:       ref.Kind,
			Name:       ref.Name,
			Namespace:  ref.Namespace,
			Replicas:   replicas,
			IsSPOF:     isSPOF,
			HasHPA:     hasHPA,
			HasPDB:     hasPDB,
			IsScalable: scalableKinds[ref.Kind],
		})
	}
	return workloads
}

// GetCriticalityScores returns criticality info for all nodes in the snapshot.
func (a *SnapshotAdapter) GetCriticalityScores() map[string]CriticalityInfo {
	scores := make(map[string]CriticalityInfo, len(a.snap.NodeScores))

	for key, score := range a.snap.NodeScores {
		ref := a.snap.Nodes[key]
		replicas := a.snap.NodeReplicas[key]
		hasHPA := a.snap.NodeHasHPA[key]
		hasPDB := a.snap.NodeHasPDB[key]
		fanIn := len(a.snap.Reverse[key])
		isSPOF := replicas <= 1 && !hasHPA && fanIn > 0

		scores[key] = CriticalityInfo{
			Score:      score,
			FanIn:      fanIn,
			IsSPOF:     isSPOF,
			HasHPA:     hasHPA,
			HasPDB:     hasPDB,
			Replicas:   replicas,
			IsScalable: scalableKinds[ref.Kind],
		}
	}
	return scores
}

// GetEdges returns all dependency edges from the snapshot.
func (a *SnapshotAdapter) GetEdges() []EdgeInfo {
	edges := make([]EdgeInfo, 0, len(a.snap.Edges))

	for _, e := range a.snap.Edges {
		srcKey := refKey(e.Source)
		tgtKey := refKey(e.Target)

		edges = append(edges, EdgeInfo{
			SourceKey:       srcKey,
			TargetKey:       tgtKey,
			SourceNamespace: e.Source.Namespace,
			TargetNamespace: e.Target.Namespace,
		})
	}
	return edges
}

// refKey builds a canonical "Kind/Namespace/Name" key for a ResourceRef.
// Mirrors graph.refKey for consistency.
func refKey(r models.ResourceRef) string {
	return fmt.Sprintf("%s/%s/%s", r.Kind, r.Namespace, r.Name)
}
