package registry

import (
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func FilterByTags(entries []models.AddOnEntry, tags []string) []models.AddOnEntry {
	if len(tags) == 0 {
		return entries
	}
	lookup := make(map[string]struct{}, len(tags))
	for i := range tags {
		t := strings.ToLower(strings.TrimSpace(tags[i]))
		if t != "" {
			lookup[t] = struct{}{}
		}
	}
	if len(lookup) == 0 {
		return entries
	}
	out := make([]models.AddOnEntry, 0, len(entries))
	for i := range entries {
		for j := range entries[i].Tags {
			if _, ok := lookup[strings.ToLower(strings.TrimSpace(entries[i].Tags[j]))]; ok {
				out = append(out, entries[i])
				break
			}
		}
	}
	return out
}

func FilterByK8sVersion(entries []models.AddOnEntry, k8sVersion string) []models.AddOnEntry {
	k8sVersion = strings.TrimSpace(k8sVersion)
	if k8sVersion == "" {
		return entries
	}
	v, err := semver.NewVersion(strings.TrimPrefix(k8sVersion, "v"))
	if err != nil {
		return entries
	}

	out := make([]models.AddOnEntry, 0, len(entries))
	for i := range entries {
		minV, minErr := semver.NewVersion(strings.TrimPrefix(entries[i].K8sCompatMin, "v"))
		if minErr != nil {
			continue
		}
		if v.LessThan(minV) {
			continue
		}
		if entries[i].K8sCompatMax != "" {
			maxV, maxErr := semver.NewVersion(strings.TrimPrefix(entries[i].K8sCompatMax, "v"))
			if maxErr == nil && v.GreaterThan(maxV) {
				continue
			}
		}
		out = append(out, entries[i])
	}
	return out
}

func ScoreSearch(entry models.AddOnEntry, query string) int {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return 1
	}

	score := 0
	name := strings.ToLower(entry.Name)
	displayName := strings.ToLower(entry.DisplayName)
	description := strings.ToLower(entry.Description)

	if name == query {
		score += 10
	}
	if strings.Contains(name, query) {
		score += 5
	}
	if strings.Contains(displayName, query) {
		score += 3
	}
	if strings.Contains(description, query) {
		score += 1
	}
	for i := range entry.Tags {
		if strings.Contains(strings.ToLower(entry.Tags[i]), query) {
			score += 2
		}
	}
	return score
}

func RankAndFilter(entries []models.AddOnEntry, query string) []models.AddOnEntry {
	type scoredEntry struct {
		entry models.AddOnEntry
		score int
	}
	scored := make([]scoredEntry, 0, len(entries))
	for i := range entries {
		score := ScoreSearch(entries[i], query)
		if strings.TrimSpace(query) != "" && score == 0 {
			continue
		}
		scored = append(scored, scoredEntry{entry: entries[i], score: score})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score == scored[j].score {
			return scored[i].entry.Name < scored[j].entry.Name
		}
		return scored[i].score > scored[j].score
	})

	out := make([]models.AddOnEntry, 0, len(scored))
	for i := range scored {
		out = append(out, scored[i].entry)
	}
	return out
}
