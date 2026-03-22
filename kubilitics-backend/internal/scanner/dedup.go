package scanner

// Deduplicate removes duplicate findings based on their computed ID.
// When duplicates exist, the first occurrence is kept.
func Deduplicate(findings []Finding) []Finding {
	seen := make(map[string]bool, len(findings))
	result := make([]Finding, 0, len(findings))
	for _, f := range findings {
		id := f.ID
		if id == "" {
			id = f.ComputeID()
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, f)
	}
	return result
}
