package resolver

func DetectCycle(g *DependencyGraph) (bool, []string) {
	visited := make(map[string]bool, len(g.nodes))
	stack := make(map[string]bool, len(g.nodes))
	parent := make(map[string]string, len(g.nodes))

	for id := range g.nodes {
		if visited[id] {
			continue
		}
		if hasCycle, start, end := dfsCycle(g, id, visited, stack, parent); hasCycle {
			path := FindCyclePath(g, start, end)
			if len(path) > 0 && path[0] != path[len(path)-1] {
				path = append(path, path[0])
			}
			return true, path
		}
	}
	return false, nil
}

func dfsCycle(g *DependencyGraph, current string, visited, stack map[string]bool, parent map[string]string) (bool, string, string) {
	visited[current] = true
	stack[current] = true

	for _, next := range g.Neighbors(current) {
		if !visited[next] {
			parent[next] = current
			if found, start, end := dfsCycle(g, next, visited, stack, parent); found {
				return true, start, end
			}
			continue
		}
		if stack[next] {
			return true, next, current
		}
	}
	stack[current] = false
	return false, "", ""
}

func FindCyclePath(g *DependencyGraph, start, end string) []string {
	if start == "" || end == "" {
		return nil
	}
	if start == end {
		return []string{start}
	}

	type nodePath struct {
		ID   string
		Path []string
	}
	queue := []nodePath{{ID: start, Path: []string{start}}}
	visited := map[string]struct{}{start: {}}

	for len(queue) > 0 {
		item := queue[0]
		queue = queue[1:]
		for _, neighbor := range g.Neighbors(item.ID) {
			newPath := append(append([]string{}, item.Path...), neighbor)
			if neighbor == end {
				return newPath
			}
			if _, ok := visited[neighbor]; ok {
				continue
			}
			visited[neighbor] = struct{}{}
			queue = append(queue, nodePath{ID: neighbor, Path: newPath})
		}
	}
	return nil
}
