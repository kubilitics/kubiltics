package simulation

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"gopkg.in/yaml.v3"
)

// deleteResource removes a single resource from the snapshot by its refKey
// (Kind/Namespace/Name). It cleans up Nodes, Forward, Reverse, Edges, and all
// per-node metadata maps.
func deleteResource(snap *graph.GraphSnapshot, key string) error {
	if _, ok := snap.Nodes[key]; !ok {
		return fmt.Errorf("resource %q not found in graph", key)
	}

	// Remove from Nodes
	delete(snap.Nodes, key)

	// Remove from Forward: delete outgoing edges and clean reverse pointers
	if targets, ok := snap.Forward[key]; ok {
		for target := range targets {
			if rev, rok := snap.Reverse[target]; rok {
				delete(rev, key)
				if len(rev) == 0 {
					delete(snap.Reverse, target)
				}
			}
		}
		delete(snap.Forward, key)
	}

	// Remove from Reverse: delete incoming edges and clean forward pointers
	if sources, ok := snap.Reverse[key]; ok {
		for source := range sources {
			if fwd, fok := snap.Forward[source]; fok {
				delete(fwd, key)
				if len(fwd) == 0 {
					delete(snap.Forward, source)
				}
			}
		}
		delete(snap.Reverse, key)
	}

	// Remove edges involving this key
	filtered := snap.Edges[:0]
	for _, e := range snap.Edges {
		sk := graph.RefKey(e.Source)
		tk := graph.RefKey(e.Target)
		if sk != key && tk != key {
			filtered = append(filtered, e)
		}
	}
	snap.Edges = filtered

	// Remove from metadata maps
	delete(snap.NodeScores, key)
	delete(snap.NodeReplicas, key)
	delete(snap.NodeHasHPA, key)
	delete(snap.NodeHasPDB, key)
	delete(snap.NodeIngress, key)
	delete(snap.NodeRisks, key)

	return nil
}

// deleteNamespace removes all resources in the given namespace from the snapshot.
func deleteNamespace(snap *graph.GraphSnapshot, ns string) error {
	// Collect all keys in the namespace first (avoid mutating during iteration).
	var toDelete []string
	for key, ref := range snap.Nodes {
		if ref.Namespace == ns {
			toDelete = append(toDelete, key)
		}
	}
	if len(toDelete) == 0 {
		return fmt.Errorf("namespace %q not found or contains no resources", ns)
	}

	for _, key := range toDelete {
		// Ignore individual errors — resource was already removed by a
		// prior cascade or edge cleanup.
		_ = deleteResource(snap, key)
	}

	delete(snap.Namespaces, ns)
	return nil
}

// nodeFailure simulates a Kubernetes node going down. Only Pods scheduled on
// that node are removed; owning controllers (Deployments, StatefulSets, etc.)
// survive because the control plane would reschedule.
//
// The node is identified by name. Pods are found by matching "Pod/<ns>/<name>"
// keys where the pod's parent (via Reverse edges) includes a Node key.
// Since the graph builder may not always model Node->Pod edges, we fall back
// to matching pods whose name contains the node name pattern.
func nodeFailure(snap *graph.GraphSnapshot, nodeName string) error {
	if nodeName == "" {
		return fmt.Errorf("node_name is required for node_failure scenario")
	}

	// Find all Pod keys to remove.
	// Strategy: look for pods that have an edge to/from a Node with matching name,
	// OR pods whose name starts with the node name (for clusters without Node objects in the graph).
	var podsToRemove []string

	// Build a set of node keys that match.
	// Node is cluster-scoped — refKey format is "Node//<name>" (Kind/Namespace/Name where namespace is empty).
	// Also try "Node/<name>" in case graph builder uses that convention.
	nodeKey := fmt.Sprintf("Node//%s", nodeName)
	_, nodeInGraph := snap.Nodes[nodeKey]
	if !nodeInGraph {
		altKey := fmt.Sprintf("Node/%s", nodeName)
		if _, ok := snap.Nodes[altKey]; ok {
			nodeKey = altKey
			nodeInGraph = true
		}
	}
	// Also try scanning all Node-kind entries for a name match (handles any key format)
	if !nodeInGraph {
		for k, ref := range snap.Nodes {
			if ref.Kind == "Node" && ref.Name == nodeName {
				nodeKey = k
				nodeInGraph = true
				break
			}
		}
	}

	for key, ref := range snap.Nodes {
		if ref.Kind != "Pod" {
			continue
		}
		// If the node is in the graph, check Forward/Reverse edges for a relationship
		if nodeInGraph {
			// Check if pod has forward edge to node (pod scheduled on node)
			if snap.Forward[key] != nil && snap.Forward[key][nodeKey] {
				podsToRemove = append(podsToRemove, key)
				continue
			}
			// Check reverse: node -> pod
			if snap.Reverse[key] != nil && snap.Reverse[key][nodeKey] {
				podsToRemove = append(podsToRemove, key)
				continue
			}
		}
		// Fallback: match pods whose name starts with the node name
		// This covers the common case where the graph does not model Node objects.
		if strings.HasPrefix(ref.Name, nodeName+"-") {
			podsToRemove = append(podsToRemove, key)
		}
	}

	if len(podsToRemove) == 0 && !nodeInGraph {
		// Non-fatal: the node may exist in the cluster but not in the graph
		// (e.g., graph doesn't include Node objects at this depth level).
		// Return nil to allow the simulation to proceed with whatever other
		// scenarios are in the chain.
		return nil
	}

	for _, key := range podsToRemove {
		_ = deleteResource(snap, key)
	}

	// Remove the node itself if present
	if nodeInGraph {
		_ = deleteResource(snap, nodeKey)
	}

	return nil
}

// azFailure simulates an entire availability zone going down by calling
// nodeFailure for every Node whose name or key matches the given AZ label.
// Since the graph typically stores Nodes with their host name, the AZ label
// is matched against node names that contain the AZ identifier.
func azFailure(snap *graph.GraphSnapshot, azLabel string) error {
	if azLabel == "" {
		return fmt.Errorf("az_label is required for az_failure scenario")
	}

	// Find all Node names matching this AZ.
	var nodeNames []string
	for _, ref := range snap.Nodes {
		if ref.Kind == "Node" && strings.Contains(ref.Name, azLabel) {
			nodeNames = append(nodeNames, ref.Name)
		}
	}

	if len(nodeNames) == 0 {
		return fmt.Errorf("no nodes found matching availability zone %q", azLabel)
	}

	for _, nn := range nodeNames {
		// nodeFailure handles not-found gracefully, so errors are non-fatal here
		_ = nodeFailure(snap, nn)
	}
	return nil
}

// scaleChange updates the replica count for a workload.
func scaleChange(snap *graph.GraphSnapshot, key string, newReplicas int) error {
	if _, ok := snap.Nodes[key]; !ok {
		return fmt.Errorf("resource %q not found in graph", key)
	}
	if newReplicas < 0 {
		return fmt.Errorf("replicas must be >= 0, got %d", newReplicas)
	}
	snap.NodeReplicas[key] = newReplicas
	return nil
}

// yamlResource is a minimal struct to extract kind/namespace/name from a YAML manifest.
type yamlResource struct {
	APIVersion string `yaml:"apiVersion"`
	Kind       string `yaml:"kind"`
	Metadata   struct {
		Name      string `yaml:"name"`
		Namespace string `yaml:"namespace"`
	} `yaml:"metadata"`
	Spec struct {
		Replicas *int `yaml:"replicas"`
		Selector struct {
			MatchLabels map[string]string `yaml:"matchLabels"`
		} `yaml:"selector"`
	} `yaml:"spec"`
}

// deployNew parses a YAML manifest and adds the resulting resource(s) to the snapshot.
// It creates nodes and basic edges (owner-ref style) for v1.
func deployNew(snap *graph.GraphSnapshot, yamlManifest string) error {
	if strings.TrimSpace(yamlManifest) == "" {
		return fmt.Errorf("manifest_yaml is required for deploy_new scenario")
	}

	var res yamlResource
	if err := yaml.Unmarshal([]byte(yamlManifest), &res); err != nil {
		return fmt.Errorf("failed to parse YAML manifest: %w", err)
	}

	if res.Kind == "" {
		return fmt.Errorf("manifest missing kind field")
	}
	if res.Metadata.Name == "" {
		return fmt.Errorf("manifest missing metadata.name field")
	}

	ns := res.Metadata.Namespace
	if ns == "" {
		ns = "default"
	}

	ref := models.ResourceRef{
		Kind:      res.Kind,
		Namespace: ns,
		Name:      res.Metadata.Name,
	}
	key := graph.RefKey(ref)

	// Add node
	snap.Nodes[key] = ref
	snap.Namespaces[ns] = true

	// Set replicas if applicable
	if res.Spec.Replicas != nil {
		snap.NodeReplicas[key] = *res.Spec.Replicas
	}

	// Infer edges based on selector match labels -> existing Services
	if len(res.Spec.Selector.MatchLabels) > 0 {
		for svcKey, svcRef := range snap.Nodes {
			if svcRef.Kind != "Service" {
				continue
			}
			if svcRef.Namespace != ns {
				continue
			}
			// Add forward edge: new resource -> service (service selects this workload)
			// Actually, Service depends on the workload (Service -> Deployment).
			// In the graph model, Forward[svc] contains what svc depends on,
			// so Reverse[workload] should contain the service.
			if snap.Forward[svcKey] == nil {
				snap.Forward[svcKey] = make(map[string]bool)
			}
			snap.Forward[svcKey][key] = true

			if snap.Reverse[key] == nil {
				snap.Reverse[key] = make(map[string]bool)
			}
			snap.Reverse[key][svcKey] = true

			snap.Edges = append(snap.Edges, models.BlastDependencyEdge{
				Source: svcRef,
				Target: ref,
				Type:   "selector",
				Detail: fmt.Sprintf("Service %s/%s selects %s/%s", svcRef.Namespace, svcRef.Name, ref.Kind, ref.Name),
			})
		}
	}

	return nil
}
