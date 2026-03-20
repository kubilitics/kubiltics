// aggregate provides helpers to sum pod usage into controller totals.
// We parse the formatted strings (e.g. "10.50m", "32.00Mi") to avoid
// coupling the provider to aggregation logic.
package metrics

import (
	"strconv"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// AggregatePodUsages sums CPU (millicores) and memory (Mi) from pod usages
// and returns formatted total CPU and total memory strings.
func AggregatePodUsages(pods []*models.PodUsage) (totalCPU, totalMemory string) {
	var cpuMilli, memMi float64
	for _, p := range pods {
		if p == nil {
			continue
		}
		c, _ := parseCPUToMilli(p.CPU)
		m, _ := parseMemoryToMi(p.Memory)
		cpuMilli += c
		memMi += m
	}
	return formatCPU(cpuMilli), formatMemoryMi(memMi)
}

// parseCPUToMilli parses "10.50m" -> 10.5, "1" or "1000m" style not supported here.
func parseCPUToMilli(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	s = strings.TrimSuffix(strings.ToLower(s), "m")
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// parseMemoryToMi parses "32.00Mi" -> 32.0.
func parseMemoryToMi(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, true
	}
	s = strings.TrimSuffix(strings.ToLower(s), "i")
	s = strings.TrimSuffix(s, "m")
	s = strings.TrimSuffix(s, "k")
	s = strings.TrimSuffix(s, "g")
	s = strings.TrimSuffix(s, "e")
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	// Mi already stripped "i" and "m" leaves "32.00m" -> we stripped to "32.00"
	// Actually "32.00Mi" -> ToLower "32.00mi" -> TrimSuffix "i" -> "32.00m" -> TrimSuffix "m" -> "32.00". Good.
	return n, true
}
