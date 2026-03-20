package cost

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// ResourceFetcher is the minimal interface CostPipeline needs from the backend.
type ResourceFetcher interface {
	ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error)
}

// EfficiencyScore quantifies how efficiently a resource is using its allocated capacity.
type EfficiencyScore struct {
	ResourceID  string  `json:"resource_id"`
	Namespace   string  `json:"namespace"`
	Kind        string  `json:"kind"`
	Name        string  `json:"name"`
	CPUScore    float64 `json:"cpu_efficiency_pct"`    // 0-100: actual/requested * 100
	MemoryScore float64 `json:"memory_efficiency_pct"` // 0-100
	Overall     float64 `json:"overall_efficiency_pct"`
	Waste       float64 `json:"estimated_monthly_waste_usd"`
	Grade       string  `json:"grade"` // A/B/C/D/F
}

// NamespaceCost holds rolled-up cost for a namespace.
type NamespaceCost struct {
	Namespace     string  `json:"namespace"`
	CostPerHour   float64 `json:"cost_per_hour"`
	CostPerDay    float64 `json:"cost_per_day"`
	CostPerMonth  float64 `json:"cost_per_month"`
	ResourceCount int     `json:"resource_count"`
	PodCount      int     `json:"pod_count"`
	NodeCount     int     `json:"node_count"`
}

// CostSnapshot is a point-in-time cost summary for trend storage.
type CostSnapshot struct {
	Timestamp      time.Time          `json:"timestamp"`
	TotalCostHour  float64            `json:"total_cost_hour"`
	TotalCostDay   float64            `json:"total_cost_day"`
	TotalCostMonth float64            `json:"total_cost_month"`
	ByNamespace    map[string]float64 `json:"by_namespace"`
	ByResourceType map[string]float64 `json:"by_resource_type"`
	ResourceCount  int                `json:"resource_count"`
	Efficiencies   []EfficiencyScore  `json:"top_waste_resources"`
	Optimizations  []Optimization     `json:"top_optimizations"`
}

// CostPipeline orchestrates real cost calculation from live cluster data.
type CostPipeline struct {
	mu         sync.RWMutex
	fetcher    ResourceFetcher
	calculator *CostCalculator
	optimizer  *CostOptimizer

	// In-memory daily cost snapshots (ring buffer: 30 days).
	snapshots []CostSnapshot
	maxSnaps  int

	// Custom pricing override support.
	customPricing *PricingConfig

	// Last scrape result.
	lastSnapshot *CostSnapshot
}

// NewCostPipeline creates a pipeline backed by the given resource fetcher.
// provider defaults to ProviderGeneric if empty.
func NewCostPipeline(fetcher ResourceFetcher, provider CloudProvider) *CostPipeline {
	if provider == "" {
		provider = ProviderGeneric
	}
	calc := NewCostCalculator(provider)
	return &CostPipeline{
		fetcher:    fetcher,
		calculator: calc,
		optimizer:  NewCostOptimizer(calc),
		snapshots:  make([]CostSnapshot, 0, 30),
		maxSnaps:   30,
	}
}

// SetCustomPricing overrides the default cloud-provider pricing.
func (p *CostPipeline) SetCustomPricing(cfg PricingConfig) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.customPricing = &cfg
	p.calculator = NewCostCalculatorWithPricing(cfg)
	p.optimizer = NewCostOptimizer(p.calculator)
}

// GetCurrentProvider returns the active cloud provider string.
func (p *CostPipeline) GetCurrentProvider() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return string(p.calculator.GetPricing().Provider)
}

// Scrape queries the backend for all resources and computes a full cost snapshot.
// Designed to be called on demand (REST API request) or periodically.
func (p *CostPipeline) Scrape(ctx context.Context) (*CostSnapshot, error) {
	p.mu.RLock()
	calc := p.calculator
	opt := p.optimizer
	p.mu.RUnlock()

	var allCosts []ResourceCost
	var efficiencies []EfficiencyScore
	var optimizations []Optimization

	// ─── Pods ──────────────────────────────────────────────────────────────────
	pods, _ := p.listResources(ctx, "Pod", "")
	for _, pod := range pods {
		rc, eff, opts := p.processPod(ctx, pod, calc, opt)
		if rc != nil {
			allCosts = append(allCosts, *rc)
		}
		if eff != nil {
			efficiencies = append(efficiencies, *eff)
		}
		optimizations = append(optimizations, opts...)
	}

	// ─── Nodes ─────────────────────────────────────────────────────────────────
	nodes, _ := p.listResources(ctx, "Node", "")
	for _, node := range nodes {
		rc, eff, opts := p.processNode(ctx, node, calc, opt)
		if rc != nil {
			allCosts = append(allCosts, *rc)
		}
		if eff != nil {
			efficiencies = append(efficiencies, *eff)
		}
		optimizations = append(optimizations, opts...)
	}

	// ─── PVCs ──────────────────────────────────────────────────────────────────
	pvcs, _ := p.listResources(ctx, "PersistentVolumeClaim", "")
	for _, pvc := range pvcs {
		rc := p.processPVC(pvc, calc)
		if rc != nil {
			allCosts = append(allCosts, *rc)
		}
	}

	// ─── Services (LoadBalancer type) ──────────────────────────────────────────
	svcs, _ := p.listResources(ctx, "Service", "")
	for _, svc := range svcs {
		rc := p.processService(svc, calc)
		if rc != nil {
			allCosts = append(allCosts, *rc)
		}
	}

	// ─── Aggregate ─────────────────────────────────────────────────────────────
	clusterCost := calc.AggregateClusterCost(allCosts)

	// Sort efficiencies by waste descending (worst first).
	sort.Slice(efficiencies, func(i, j int) bool {
		return efficiencies[i].Waste > efficiencies[j].Waste
	})

	// Sort optimizations by savings descending.
	sort.Slice(optimizations, func(i, j int) bool {
		return optimizations[i].Savings > optimizations[j].Savings
	})

	// Cap to top 20.
	topEff := efficiencies
	if len(topEff) > 20 {
		topEff = topEff[:20]
	}
	topOpts := optimizations
	if len(topOpts) > 20 {
		topOpts = topOpts[:20]
	}

	byType := make(map[string]float64)
	for rt, v := range clusterCost.ByResourceType {
		byType[string(rt)] = v
	}

	snap := &CostSnapshot{
		Timestamp:      time.Now(),
		TotalCostHour:  clusterCost.TotalCostHour,
		TotalCostDay:   clusterCost.TotalCostDay,
		TotalCostMonth: clusterCost.TotalCostMonth,
		ByNamespace:    clusterCost.ByNamespace,
		ByResourceType: byType,
		ResourceCount:  clusterCost.ResourceCount,
		Efficiencies:   topEff,
		Optimizations:  topOpts,
	}

	p.mu.Lock()
	p.lastSnapshot = snap
	p.recordSnapshot(*snap)
	p.mu.Unlock()

	return snap, nil
}

// GetLastSnapshot returns the most-recent cost snapshot (nil if never scraped).
func (p *CostPipeline) GetLastSnapshot() *CostSnapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastSnapshot
}

// GetSnapshots returns stored daily snapshots (oldest first).
func (p *CostPipeline) GetSnapshots() []CostSnapshot {
	p.mu.RLock()
	defer p.mu.RUnlock()
	result := make([]CostSnapshot, len(p.snapshots))
	copy(result, p.snapshots)
	return result
}

// GetNamespaceCosts returns per-namespace cost breakdown from the last snapshot.
func (p *CostPipeline) GetNamespaceCosts(ctx context.Context) ([]NamespaceCost, error) {
	snap := p.GetLastSnapshot()
	if snap == nil {
		var err error
		snap, err = p.Scrape(ctx)
		if err != nil {
			return nil, err
		}
	}

	// Count pods per namespace
	pods, _ := p.listResources(ctx, "Pod", "")
	podsByNS := map[string]int{}
	for _, pod := range pods {
		podsByNS[pod.Namespace]++
	}
	nodes, _ := p.listResources(ctx, "Node", "")
	nodesByNS := map[string]int{}
	for _, n := range nodes {
		nodesByNS[n.Namespace]++
	}

	result := make([]NamespaceCost, 0, len(snap.ByNamespace))
	for ns, hourCost := range snap.ByNamespace {
		result = append(result, NamespaceCost{
			Namespace:     ns,
			CostPerHour:   hourCost,
			CostPerDay:    hourCost * 24,
			CostPerMonth:  hourCost * 24 * 30,
			ResourceCount: podsByNS[ns] + nodesByNS[ns],
			PodCount:      podsByNS[ns],
			NodeCount:     nodesByNS[ns],
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CostPerMonth > result[j].CostPerMonth
	})
	return result, nil
}

// GetEfficiencyReport returns all efficiency scores (worst first).
func (p *CostPipeline) GetEfficiencyReport(ctx context.Context) ([]EfficiencyScore, error) {
	snap := p.GetLastSnapshot()
	if snap == nil {
		var err error
		snap, err = p.Scrape(ctx)
		if err != nil {
			return nil, err
		}
	}
	return snap.Efficiencies, nil
}

// GetOptimizationRecommendations returns ranked optimization recommendations.
func (p *CostPipeline) GetOptimizationRecommendations(ctx context.Context) ([]Optimization, float64, error) {
	snap := p.GetLastSnapshot()
	if snap == nil {
		var err error
		snap, err = p.Scrape(ctx)
		if err != nil {
			return nil, 0, err
		}
	}
	totalSavings := p.optimizer.CalculateTotalSavings(snap.Optimizations)
	return snap.Optimizations, totalSavings, nil
}

// GetCostForecast returns 6-month cost forecast using linear regression on snapshots.
func (p *CostPipeline) GetCostForecast() []map[string]interface{} {
	p.mu.RLock()
	snaps := make([]CostSnapshot, len(p.snapshots))
	copy(snaps, p.snapshots)
	lastSnap := p.lastSnapshot
	p.mu.RUnlock()

	// Need at least 2 snapshots for regression; otherwise use last known cost.
	baseMonthly := 0.0
	if lastSnap != nil {
		baseMonthly = lastSnap.TotalCostMonth
	}

	var slope float64
	if len(snaps) >= 2 {
		vals := make([]float64, len(snaps))
		for i, s := range snaps {
			vals[i] = s.TotalCostMonth
		}
		slope, _ = linearRegressionCost(vals)
	} else {
		// Default 3% monthly growth assumption.
		slope = baseMonthly * 0.03
	}

	forecast := make([]map[string]interface{}, 6)
	for i := 0; i < 6; i++ {
		projected := baseMonthly + slope*float64(i+1)
		if projected < 0 {
			projected = 0
		}
		// ±8% CI
		margin := projected * 0.08
		forecast[i] = map[string]interface{}{
			"month":      i + 1,
			"cost":       projected,
			"lower_95":   math.Max(0, projected-margin),
			"upper_95":   projected + margin,
			"trend":      trendDirection(slope),
			"growth_pct": safeGrowthPct(baseMonthly, projected),
		}
	}
	return forecast
}

// GetPricingConfig returns the active pricing config.
func (p *CostPipeline) GetPricingConfig() PricingConfig {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.calculator.GetPricing()
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

func (p *CostPipeline) listResources(ctx context.Context, kind, ns string) ([]*pb.Resource, error) {
	if p.fetcher == nil {
		return nil, nil
	}
	return p.fetcher.ListResources(ctx, kind, ns)
}

// processPod extracts cost + efficiency for a pod.
func (p *CostPipeline) processPod(_ context.Context, pod *pb.Resource, calc *CostCalculator, opt *CostOptimizer) (*ResourceCost, *EfficiencyScore, []Optimization) {
	var data map[string]interface{}
	if len(pod.Data) > 0 {
		_ = json.Unmarshal(pod.Data, &data)
	}

	// Extract requested resources from spec.containers
	reqCPU, reqMem := extractPodRequests(data)
	// Extract actual usage (best-effort; may be 0 if not available)
	actCPU, actMem := extractPodUsage(data)

	// Default to 1 vCPU / 0.5 GiB if spec is absent (graceful degradation).
	if reqCPU == 0 {
		reqCPU = 1.0
	}
	if reqMem == 0 {
		reqMem = 0.5
	}
	// Actual usage: if not available assume 60% utilization as conservative estimate.
	if actCPU == 0 {
		actCPU = reqCPU * 0.6
	}
	if actMem == 0 {
		actMem = reqMem * 0.6
	}

	rc := calc.CalculatePodCost(pod.Name, pod.Namespace, reqCPU, reqMem, 720)

	// Efficiency
	cpuEff := clamp(actCPU/reqCPU*100, 0, 100)
	memEff := clamp(actMem/reqMem*100, 0, 100)
	overall := (cpuEff + memEff) / 2

	// Waste = cost of over-provisioned portion (monthly).
	wasteFraction := 1.0 - overall/100
	waste := rc.TotalCostMonth * wasteFraction

	eff := &EfficiencyScore{
		ResourceID:  fmt.Sprintf("%s/%s/%s", pod.Namespace, pod.Kind, pod.Name),
		Namespace:   pod.Namespace,
		Kind:        pod.Kind,
		Name:        pod.Name,
		CPUScore:    cpuEff,
		MemoryScore: memEff,
		Overall:     overall,
		Waste:       waste,
		Grade:       efficiencyGrade(overall),
	}

	opts := opt.AnalyzePodOptimization(pod.Name, pod.Namespace, reqCPU, actCPU, reqMem, actMem, 720)
	return &rc, eff, opts
}

// processNode extracts cost + efficiency for a node.
func (p *CostPipeline) processNode(_ context.Context, node *pb.Resource, calc *CostCalculator, opt *CostOptimizer) (*ResourceCost, *EfficiencyScore, []Optimization) {
	var data map[string]interface{}
	if len(node.Data) > 0 {
		_ = json.Unmarshal(node.Data, &data)
	}

	totalCPU, totalMem, usedCPU, usedMem := extractNodeCapacity(data)

	// Defaults for nodes with no data.
	if totalCPU == 0 {
		totalCPU = 4.0
	}
	if totalMem == 0 {
		totalMem = 16.0
	}
	if usedCPU == 0 {
		usedCPU = totalCPU * 0.5
	}
	if usedMem == 0 {
		usedMem = totalMem * 0.5
	}

	rc := calc.CalculateNodeCost(node.Name, totalCPU, totalMem)

	cpuEff := clamp(usedCPU/totalCPU*100, 0, 100)
	memEff := clamp(usedMem/totalMem*100, 0, 100)
	overall := (cpuEff + memEff) / 2
	waste := rc.TotalCostMonth * (1.0 - overall/100)

	eff := &EfficiencyScore{
		ResourceID:  fmt.Sprintf("/%s/%s", node.Kind, node.Name),
		Namespace:   "",
		Kind:        node.Kind,
		Name:        node.Name,
		CPUScore:    cpuEff,
		MemoryScore: memEff,
		Overall:     overall,
		Waste:       waste,
		Grade:       efficiencyGrade(overall),
	}

	opts := opt.AnalyzeNodeOptimization(node.Name, totalCPU, usedCPU, totalMem, usedMem)
	return &rc, eff, opts
}

// processPVC extracts cost for a PVC.
func (p *CostPipeline) processPVC(pvc *pb.Resource, calc *CostCalculator) *ResourceCost {
	var data map[string]interface{}
	if len(pvc.Data) > 0 {
		_ = json.Unmarshal(pvc.Data, &data)
	}

	sizeGB := extractPVCSize(data)
	if sizeGB == 0 {
		sizeGB = 10.0 // default 10 GiB
	}

	rc := calc.CalculatePVCCost(pvc.Name, pvc.Namespace, sizeGB)
	return &rc
}

// processService extracts cost for LoadBalancer services.
func (p *CostPipeline) processService(svc *pb.Resource, calc *CostCalculator) *ResourceCost {
	var data map[string]interface{}
	if len(svc.Data) > 0 {
		_ = json.Unmarshal(svc.Data, &data)
	}

	spec, _ := data["spec"].(map[string]interface{})
	if spec == nil {
		return nil
	}
	svcType, _ := spec["type"].(string)
	if svcType != "LoadBalancer" {
		return nil
	}

	// Assume 100 GB/month egress by default (can be refined via metrics).
	rc := calc.CalculateLoadBalancerCost(svc.Name, svc.Namespace, 100.0)
	return &rc
}

// recordSnapshot appends to the ring buffer, dropping oldest if at capacity.
func (p *CostPipeline) recordSnapshot(snap CostSnapshot) {
	if len(p.snapshots) >= p.maxSnaps {
		p.snapshots = p.snapshots[1:]
	}
	p.snapshots = append(p.snapshots, snap)
}

// ─── Data extraction helpers ──────────────────────────────────────────────────

func extractPodRequests(data map[string]interface{}) (cpuCores, memGB float64) {
	spec, _ := data["spec"].(map[string]interface{})
	if spec == nil {
		return 0, 0
	}
	containers, _ := spec["containers"].([]interface{})
	for _, c := range containers {
		cm, _ := c.(map[string]interface{})
		if cm == nil {
			continue
		}
		resources, _ := cm["resources"].(map[string]interface{})
		if resources == nil {
			continue
		}
		requests, _ := resources["requests"].(map[string]interface{})
		if requests == nil {
			continue
		}
		if cpu, ok := requests["cpu"].(string); ok {
			if v, err := ParseCPU(cpu); err == nil {
				cpuCores += v
			}
		}
		if mem, ok := requests["memory"].(string); ok {
			if v, err := ParseMemory(mem); err == nil {
				memGB += v
			}
		}
	}
	return
}

func extractPodUsage(data map[string]interface{}) (cpuCores, memGB float64) {
	// Try metrics sub-field first.
	metrics, _ := data["metrics"].(map[string]interface{})
	if metrics != nil {
		if v, ok := metrics["cpu_cores"].(float64); ok {
			cpuCores = v
		}
		if v, ok := metrics["memory_gb"].(float64); ok {
			memGB = v
		}
		if cpuCores > 0 || memGB > 0 {
			return
		}
	}
	// Fall through: status.containerStatuses[].resources (K8s 1.28+).
	status, _ := data["status"].(map[string]interface{})
	if status == nil {
		return
	}
	cs, _ := status["containerStatuses"].([]interface{})
	for _, c := range cs {
		cm, _ := c.(map[string]interface{})
		if cm == nil {
			continue
		}
		res, _ := cm["resources"].(map[string]interface{})
		if res == nil {
			continue
		}
		alloc, _ := res["allocatedResources"].(map[string]interface{})
		if cpu, ok := alloc["cpu"].(string); ok {
			if v, err := ParseCPU(cpu); err == nil {
				cpuCores += v
			}
		}
		if mem, ok := alloc["memory"].(string); ok {
			if v, err := ParseMemory(mem); err == nil {
				memGB += v
			}
		}
	}
	return
}

func extractNodeCapacity(data map[string]interface{}) (totalCPU, totalMem, usedCPU, usedMem float64) {
	status, _ := data["status"].(map[string]interface{})
	if status != nil {
		capacity, _ := status["capacity"].(map[string]interface{})
		if capacity != nil {
			if cpu, ok := capacity["cpu"].(string); ok {
				if v, err := ParseCPU(cpu); err == nil {
					totalCPU = v
				}
			}
			if mem, ok := capacity["memory"].(string); ok {
				if v, err := ParseMemory(mem); err == nil {
					totalMem = v
				}
			}
		}
		alloc, _ := status["allocatable"].(map[string]interface{})
		if alloc != nil && totalCPU == 0 {
			if cpu, ok := alloc["cpu"].(string); ok {
				if v, err := ParseCPU(cpu); err == nil {
					totalCPU = v
				}
			}
			if mem, ok := alloc["memory"].(string); ok {
				if v, err := ParseMemory(mem); err == nil {
					totalMem = v
				}
			}
		}
	}
	// Check metrics sub-field for actual usage.
	metrics, _ := data["metrics"].(map[string]interface{})
	if metrics != nil {
		if v, ok := metrics["cpu_cores"].(float64); ok {
			usedCPU = v
		}
		if v, ok := metrics["memory_gb"].(float64); ok {
			usedMem = v
		}
	}
	return
}

func extractPVCSize(data map[string]interface{}) float64 {
	spec, _ := data["spec"].(map[string]interface{})
	if spec == nil {
		return 0
	}
	res, _ := spec["resources"].(map[string]interface{})
	if res == nil {
		return 0
	}
	requests, _ := res["requests"].(map[string]interface{})
	if requests == nil {
		return 0
	}
	if storage, ok := requests["storage"].(string); ok {
		if v, err := ParseMemory(storage); err == nil {
			return v
		}
	}
	return 0
}

// ─── Statistical helpers ──────────────────────────────────────────────────────

func linearRegressionCost(vals []float64) (slope, intercept float64) {
	n := float64(len(vals))
	if n < 2 {
		return 0, 0
	}
	sumX, sumY, sumXY, sumX2 := 0.0, 0.0, 0.0, 0.0
	for i, v := range vals {
		x := float64(i)
		sumX += x
		sumY += v
		sumXY += x * v
		sumX2 += x * x
	}
	denom := n*sumX2 - sumX*sumX
	if math.Abs(denom) < 1e-12 {
		return 0, sumY / n
	}
	slope = (n*sumXY - sumX*sumY) / denom
	intercept = (sumY - slope*sumX) / n
	return
}

func trendDirection(slope float64) string {
	if slope > 1 {
		return "increasing"
	}
	if slope < -1 {
		return "decreasing"
	}
	return "stable"
}

func safeGrowthPct(base, projected float64) float64 {
	if base == 0 {
		return 0
	}
	return (projected - base) / base * 100
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func efficiencyGrade(pct float64) string {
	switch {
	case pct >= 80:
		return "A"
	case pct >= 65:
		return "B"
	case pct >= 50:
		return "C"
	case pct >= 35:
		return "D"
	default:
		return "F"
	}
}
