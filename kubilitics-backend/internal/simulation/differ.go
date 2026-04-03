package simulation

import (
	"github.com/kubilitics/kubilitics-backend/internal/graph"
)

// diffResult holds the raw diff between the original and mutated snapshots.
type diffResult struct {
	RemovedNodes     []NodeInfo
	AddedNodes       []NodeInfo
	ModifiedNodes    []NodeDiff
	LostEdges        []EdgeInfo
	AddedEdges       []EdgeInfo
	AffectedServices []NodeInfo
	NewSPOFs         []NodeInfo
	ResolvedSPOFs    []NodeInfo
}

// computeDiff compares the original snapshot against the mutated clone and produces
// a diffResult cataloguing every change.
func computeDiff(original, mutated *graph.GraphSnapshot) diffResult {
	var result diffResult

	// --- Removed nodes: present in original but absent in mutated ---
	for key, ref := range original.Nodes {
		if _, exists := mutated.Nodes[key]; !exists {
			result.RemovedNodes = append(result.RemovedNodes, NodeInfo{
				Key:       key,
				Kind:      ref.Kind,
				Namespace: ref.Namespace,
				Name:      ref.Name,
				Score:     original.NodeScores[key],
			})
		}
	}

	// --- Added nodes: present in mutated but absent in original ---
	for key, ref := range mutated.Nodes {
		if _, exists := original.Nodes[key]; !exists {
			result.AddedNodes = append(result.AddedNodes, NodeInfo{
				Key:       key,
				Kind:      ref.Kind,
				Namespace: ref.Namespace,
				Name:      ref.Name,
				Score:     mutated.NodeScores[key],
			})
		}
	}

	// --- Modified nodes: present in both but score or SPOF status changed ---
	for key, ref := range original.Nodes {
		if _, exists := mutated.Nodes[key]; !exists {
			continue
		}
		scoreBefore := original.NodeScores[key]
		scoreAfter := mutated.NodeScores[key]
		wasSPOF := isSPOF(original, key)
		nowSPOF := isSPOF(mutated, key)

		// Only report as modified if score changed by > 0.1 or SPOF status flipped
		scoreDelta := scoreAfter - scoreBefore
		if scoreDelta < 0 {
			scoreDelta = -scoreDelta
		}
		if scoreDelta > 0.1 || wasSPOF != nowSPOF {
			result.ModifiedNodes = append(result.ModifiedNodes, NodeDiff{
				NodeInfo: NodeInfo{
					Key:       key,
					Kind:      ref.Kind,
					Namespace: ref.Namespace,
					Name:      ref.Name,
					Score:     scoreAfter,
				},
				ScoreBefore: scoreBefore,
				ScoreAfter:  scoreAfter,
				WasSPOF:     wasSPOF,
				IsSPOF:      nowSPOF,
			})
		}
	}

	// --- Lost edges: in original but not in mutated ---
	originalEdges := buildEdgeSet(original)
	mutatedEdges := buildEdgeSet(mutated)

	for edge := range originalEdges {
		if !mutatedEdges[edge] {
			result.LostEdges = append(result.LostEdges, edge)
		}
	}

	// --- Added edges: in mutated but not in original ---
	for edge := range mutatedEdges {
		if !originalEdges[edge] {
			result.AddedEdges = append(result.AddedEdges, edge)
		}
	}

	// --- Affected services: Service nodes that lost at least one forward dependency ---
	for key, ref := range original.Nodes {
		if ref.Kind != "Service" {
			continue
		}
		if _, exists := mutated.Nodes[key]; !exists {
			// Service was removed entirely — already in RemovedNodes
			continue
		}
		origDeps := len(original.Forward[key])
		mutDeps := len(mutated.Forward[key])
		if mutDeps < origDeps {
			result.AffectedServices = append(result.AffectedServices, NodeInfo{
				Key:       key,
				Kind:      ref.Kind,
				Namespace: ref.Namespace,
				Name:      ref.Name,
				Score:     mutated.NodeScores[key],
			})
		}
	}

	// --- New SPOFs: not SPOF before, is SPOF after ---
	for key, ref := range mutated.Nodes {
		if _, existsBefore := original.Nodes[key]; !existsBefore {
			continue
		}
		wasSPOF := isSPOF(original, key)
		nowSPOF := isSPOF(mutated, key)
		if !wasSPOF && nowSPOF {
			result.NewSPOFs = append(result.NewSPOFs, NodeInfo{
				Key:       key,
				Kind:      ref.Kind,
				Namespace: ref.Namespace,
				Name:      ref.Name,
				Score:     mutated.NodeScores[key],
			})
		}
	}

	// --- Resolved SPOFs: was SPOF before, not SPOF after ---
	for key, ref := range original.Nodes {
		if _, existsAfter := mutated.Nodes[key]; !existsAfter {
			continue
		}
		wasSPOF := isSPOF(original, key)
		nowSPOF := isSPOF(mutated, key)
		if wasSPOF && !nowSPOF {
			result.ResolvedSPOFs = append(result.ResolvedSPOFs, NodeInfo{
				Key:       key,
				Kind:      ref.Kind,
				Namespace: ref.Namespace,
				Name:      ref.Name,
				Score:     mutated.NodeScores[key],
			})
		}
	}

	return result
}

// buildEdgeSet builds a set of EdgeInfo from the snapshot's Forward adjacency map.
func buildEdgeSet(snap *graph.GraphSnapshot) map[EdgeInfo]bool {
	set := make(map[EdgeInfo]bool)
	for src, targets := range snap.Forward {
		for tgt := range targets {
			set[EdgeInfo{Source: src, Target: tgt}] = true
		}
	}
	return set
}
