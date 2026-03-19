package server

// A-CORE-011: Cost Intelligence — Real Calculations
//
// All endpoints backed by CostPipeline (s.costPipeline) which scrapes live
// resources from the backend proxy and computes real efficiency scores,
// namespace attribution, optimization recommendations, and cost forecasts.
//
// Routes (all under /api/v1/cost/...):
//   GET  /api/v1/cost/overview        — cluster-wide cost snapshot (triggers scrape)
//   GET  /api/v1/cost/namespaces      — per-namespace cost attribution
//   GET  /api/v1/cost/efficiency      — resource efficiency scores (worst-first)
//   GET  /api/v1/cost/recommendations — ranked optimization recommendations
//   GET  /api/v1/cost/forecast        — 6-month linear-regression cost forecast
//   GET  /api/v1/cost/history         — stored daily cost snapshots (trend data)
//   GET  /api/v1/cost/pricing         — active pricing config
//   POST /api/v1/cost/pricing         — override pricing (custom / on-prem)
//   POST /api/v1/cost/resource        — compute cost for a single resource spec
//   POST /api/v1/cost/optimize        — optimization recommendations for one resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/cost"
)

// handleCostDispatch routes /api/v1/cost/... to the right handler.
func (s *Server) handleCostDispatch(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.Path, "/api/v1/cost")
	suffix = strings.TrimPrefix(suffix, "/")

	switch suffix {
	case "overview", "":
		s.handleCostOverview(w, r)
	case "namespaces":
		s.handleCostNamespaces(w, r)
	case "efficiency":
		s.handleCostEfficiency(w, r)
	case "recommendations":
		s.handleCostRecommendations(w, r)
	case "forecast":
		s.handleCostForecast(w, r)
	case "history":
		s.handleCostHistory(w, r)
	case "pricing":
		s.handleCostPricing(w, r)
	case "resource":
		s.handleResourceCost(w, r)
	case "optimize":
		s.handleOptimize(w, r)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// ─── OpenCost integration helpers ─────────────────────────────────────────────

// opencostResponse is the top-level structure returned by the OpenCost
// /model/allocation API.
type opencostResponse struct {
	Code int                             `json:"code"`
	Data []map[string]opencostAllocation `json:"data"`
}

// opencostAllocation contains per-namespace billing data from OpenCost.
type opencostAllocation struct {
	CPUCost      float64 `json:"cpuCost"`
	MemoryCost   float64 `json:"memoryCost"`
	NetworkCost  float64 `json:"networkCost"`
	StorageCost  float64 `json:"storageCost"`
	TotalCost    float64 `json:"totalCost"`
	CPUCoreHours float64 `json:"cpuCoreHours"`
	RAMByteHours float64 `json:"ramByteHours"`
}

// detectOpenCostEndpoint returns the OpenCost base URL to use.
// Priority (for now):
//   1. OPENCOST_ENDPOINT environment variable
// Returns "" if OpenCost is not configured.
func detectOpenCostEndpoint() string {
	if ep := strings.TrimSpace(os.Getenv("OPENCOST_ENDPOINT")); ep != "" {
		return strings.TrimRight(ep, "/")
	}
	return ""
}

// fetchOpenCostNamespaceCosts calls the OpenCost /model/allocation API and returns
// namespace-level cost summaries for the last 24 hours (scaled to month for convenience).
// Returns (summaries, nil) on success, or (nil, err) on any failure.
func fetchOpenCostNamespaceCosts(endpoint string) ([]cost.NamespaceCost, error) {
	url := endpoint + "/model/allocation?window=1d&aggregate=namespace&accumulate=true"

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(url) //nolint:noctx
	if err != nil {
		return nil, fmt.Errorf("opencost unreachable at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	var ocResp opencostResponse
	if err := json.NewDecoder(resp.Body).Decode(&ocResp); err != nil {
		return nil, fmt.Errorf("opencost response parse error: %w", err)
	}
	if resp.StatusCode != http.StatusOK || ocResp.Code != 200 || len(ocResp.Data) == 0 {
		return nil, fmt.Errorf("opencost returned no data (status=%d code=%d)", resp.StatusCode, ocResp.Code)
	}

	// Accumulate across all time buckets (there should be just one with accumulate=true).
	totals := map[string]*cost.NamespaceCost{}
	for _, bucket := range ocResp.Data {
		for ns, alloc := range bucket {
			if ns == "__unallocated__" || ns == "__idle__" {
				continue
			}
			s, ok := totals[ns]
			if !ok {
				s = &cost.NamespaceCost{Namespace: ns}
				totals[ns] = s
			}
			// OpenCost TotalCost is for the requested window (1d). Convert to per-hour/day/month.
			dayCost := alloc.TotalCost
			hourCost := alloc.TotalCost / 24.0
			monthCost := alloc.TotalCost * 30.0

			s.CostPerHour += hourCost
			s.CostPerDay += dayCost
			s.CostPerMonth += monthCost
		}
	}

	result := make([]cost.NamespaceCost, 0, len(totals))
	for _, s := range totals {
		result = append(result, *s)
	}

	// Sort by monthly cost descending.
	sort.Slice(result, func(i, j int) bool {
		return result[i].CostPerMonth > result[j].CostPerMonth
	})
	return result, nil
}

// ─── Overview ─────────────────────────────────────────────────────────────────

func (s *Server) handleCostOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// When OpenCost is configured, prefer it as the primary cost engine.
	if ep := detectOpenCostEndpoint(); ep != "" {
		nsCosts, err := fetchOpenCostNamespaceCosts(ep)
		if err == nil && len(nsCosts) > 0 {
			totalHour := 0.0
			byNamespace := make(map[string]float64, len(nsCosts))
			for _, ns := range nsCosts {
				totalHour += ns.CostPerHour
				// Use monthly cost for namespace breakdown to match dashboard expectations.
				byNamespace[ns.Namespace] = ns.CostPerMonth
			}

			jsonOK(w, map[string]interface{}{
				"total_cost_hour":       totalHour,
				"total_cost_day":        totalHour * 24,
				"total_cost_month":      totalHour * 24 * 30,
				"total_cost_year":       totalHour * 24 * 30 * 12,
				"by_namespace":          byNamespace,
				"by_resource_type":      map[string]float64{}, // OpenCost aggregation by type can be added later
				"resource_count":        0,
				"savings_opportunities": 0.0,
				"provider":              "opencost",
				"top_waste_resources":   0,
				"top_optimizations":     0,
				"timestamp":             time.Now(),
			})
			return
		}
		// If OpenCost is configured but errors, fall through to pipeline-based behaviour.
	}
	if s.costPipeline == nil {
		jsonOK(w, map[string]interface{}{
			"note":      "cost pipeline not initialised",
			"timestamp": time.Now(),
		})
		return
	}

	snap, err := s.costPipeline.Scrape(r.Context())
	if err != nil {
		http.Error(w, "cost scrape failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	totalSavings := 0.0
	for _, opt := range snap.Optimizations {
		totalSavings += opt.Savings
	}

	jsonOK(w, map[string]interface{}{
		"total_cost_hour":       snap.TotalCostHour,
		"total_cost_day":        snap.TotalCostDay,
		"total_cost_month":      snap.TotalCostMonth,
		"total_cost_year":       snap.TotalCostMonth * 12,
		"by_namespace":          snap.ByNamespace,
		"by_resource_type":      snap.ByResourceType,
		"resource_count":        snap.ResourceCount,
		"savings_opportunities": totalSavings,
		"provider":              s.costPipeline.GetCurrentProvider(),
		"top_waste_resources":   len(snap.Efficiencies),
		"top_optimizations":     len(snap.Optimizations),
		"timestamp":             snap.Timestamp,
	})
}

// ─── Namespace attribution ────────────────────────────────────────────────────

func (s *Server) handleCostNamespaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Prefer OpenCost when configured.
	if ep := detectOpenCostEndpoint(); ep != "" {
		nsCosts, err := fetchOpenCostNamespaceCosts(ep)
		if err == nil {
			jsonOK(w, map[string]interface{}{
				"namespaces": nsCosts,
				"total":      len(nsCosts),
				"timestamp":  time.Now(),
			})
			return
		}
		// On error, fall back to pipeline behaviour.
	}
	if s.costPipeline == nil {
		jsonOK(w, map[string]interface{}{"namespaces": []interface{}{}, "note": "cost pipeline not initialised"})
		return
	}

	nsCosts, err := s.costPipeline.GetNamespaceCosts(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, map[string]interface{}{
		"namespaces": nsCosts,
		"total":      len(nsCosts),
		"timestamp":  time.Now(),
	})
}

// ─── Efficiency ───────────────────────────────────────────────────────────────

func (s *Server) handleCostEfficiency(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.costPipeline == nil {
		jsonOK(w, map[string]interface{}{"efficiencies": []interface{}{}, "note": "cost pipeline not initialised"})
		return
	}

	scores, err := s.costPipeline.GetEfficiencyReport(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	grades := map[string]int{"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
	totalWaste := 0.0
	for _, e := range scores {
		grades[e.Grade]++
		totalWaste += e.Waste
	}

	jsonOK(w, map[string]interface{}{
		"efficiencies":        scores,
		"total":               len(scores),
		"grade_distribution":  grades,
		"total_monthly_waste": totalWaste,
		"timestamp":           time.Now(),
	})
}

// ─── Recommendations ─────────────────────────────────────────────────────────

func (s *Server) handleCostRecommendations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.costPipeline == nil {
		jsonOK(w, map[string]interface{}{"recommendations": []interface{}{}, "note": "cost pipeline not initialised"})
		return
	}

	opts, totalSavings, err := s.costPipeline.GetOptimizationRecommendations(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	byType := map[string]int{}
	for _, o := range opts {
		byType[string(o.Type)]++
	}

	jsonOK(w, map[string]interface{}{
		"recommendations": opts,
		"total":           len(opts),
		"total_savings":   totalSavings,
		"by_type":         byType,
		"timestamp":       time.Now(),
	})
}

// ─── Forecast ─────────────────────────────────────────────────────────────────

func (s *Server) handleCostForecast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var currentMonthly float64
	var forecast []map[string]interface{}

	if s.costPipeline != nil {
		forecast = s.costPipeline.GetCostForecast()
		snap := s.costPipeline.GetLastSnapshot()
		if snap != nil {
			currentMonthly = snap.TotalCostMonth
		}
	} else {
		forecast = make([]map[string]interface{}, 6)
		for i := range forecast {
			forecast[i] = map[string]interface{}{"month": i + 1, "cost": 0.0, "trend": "unknown"}
		}
	}

	jsonOK(w, map[string]interface{}{
		"current_monthly": currentMonthly,
		"forecast_6m":     forecast,
		"timestamp":       time.Now(),
	})
}

// ─── History ─────────────────────────────────────────────────────────────────

func (s *Server) handleCostHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.costPipeline == nil {
		jsonOK(w, map[string]interface{}{"snapshots": []interface{}{}, "count": 0})
		return
	}

	snaps := s.costPipeline.GetSnapshots()

	type lightSnap struct {
		Timestamp      time.Time          `json:"timestamp"`
		TotalCostHour  float64            `json:"total_cost_hour"`
		TotalCostDay   float64            `json:"total_cost_day"`
		TotalCostMonth float64            `json:"total_cost_month"`
		ByNamespace    map[string]float64 `json:"by_namespace"`
		ResourceCount  int                `json:"resource_count"`
	}
	light := make([]lightSnap, len(snaps))
	for i, sn := range snaps {
		light[i] = lightSnap{
			Timestamp:      sn.Timestamp,
			TotalCostHour:  sn.TotalCostHour,
			TotalCostDay:   sn.TotalCostDay,
			TotalCostMonth: sn.TotalCostMonth,
			ByNamespace:    sn.ByNamespace,
			ResourceCount:  sn.ResourceCount,
		}
	}

	jsonOK(w, map[string]interface{}{
		"snapshots": light,
		"count":     len(light),
		"timestamp": time.Now(),
	})
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

func (s *Server) handleCostPricing(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.getCostPricing(w, r)
	case http.MethodPost:
		s.setCostPricing(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) getCostPricing(w http.ResponseWriter, _ *http.Request) {
	var cfg cost.PricingConfig
	if s.costPipeline != nil {
		cfg = s.costPipeline.GetPricingConfig()
	} else {
		cfg = cost.NewCostCalculator(cost.ProviderGeneric).GetPricing()
	}
	jsonOK(w, pricingToMap(cfg))
}

func (s *Server) setCostPricing(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider               string  `json:"provider"`
		CPUPricePerHour        float64 `json:"cpu_price_per_hour"`
		MemPricePerGBHour      float64 `json:"mem_price_per_gb_hour"`
		StoragePricePerGBMonth float64 `json:"storage_price_per_gb_month"`
		NetworkPricePerGB      float64 `json:"network_price_per_gb"`
		LoadBalancerPerHour    float64 `json:"lb_price_per_hour"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.CPUPricePerHour <= 0 {
		http.Error(w, "cpu_price_per_hour must be > 0", http.StatusBadRequest)
		return
	}

	cfg := cost.PricingConfig{
		Provider:                 cost.CloudProvider(req.Provider),
		CPUPricePerHour:          req.CPUPricePerHour,
		MemPricePerGBHour:        req.MemPricePerGBHour,
		StoragePricePerGBMonth:   req.StoragePricePerGBMonth,
		NetworkPricePerGB:        req.NetworkPricePerGB,
		LoadBalancerPricePerHour: req.LoadBalancerPerHour,
	}
	if s.costPipeline != nil {
		s.costPipeline.SetCustomPricing(cfg)
	}

	jsonOK(w, map[string]interface{}{
		"status":  "updated",
		"pricing": pricingToMap(cfg),
	})
}

// ─── Per-resource cost ────────────────────────────────────────────────────────

func (s *Server) handleResourceCost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ResourceType string  `json:"resource_type"`
		ResourceName string  `json:"resource_name"`
		Namespace    string  `json:"namespace,omitempty"`
		CPUCores     float64 `json:"cpu_cores,omitempty"`
		MemoryGB     float64 `json:"memory_gb,omitempty"`
		StorageGB    float64 `json:"storage_gb,omitempty"`
		NetworkGB    float64 `json:"network_gb,omitempty"`
		HoursRunning float64 `json:"hours_running,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.ResourceType == "" || req.ResourceName == "" {
		http.Error(w, "resource_type and resource_name are required", http.StatusBadRequest)
		return
	}
	if req.HoursRunning == 0 {
		req.HoursRunning = 720
	}

	var calc *cost.CostCalculator
	if s.costPipeline != nil {
		calc = cost.NewCostCalculatorWithPricing(s.costPipeline.GetPricingConfig())
	} else {
		calc = cost.NewCostCalculator(cost.ProviderGeneric)
	}

	var rc cost.ResourceCost
	switch req.ResourceType {
	case "pod":
		rc = calc.CalculatePodCost(req.ResourceName, req.Namespace, req.CPUCores, req.MemoryGB, req.HoursRunning)
	case "node":
		rc = calc.CalculateNodeCost(req.ResourceName, req.CPUCores, req.MemoryGB)
	case "pvc":
		rc = calc.CalculatePVCCost(req.ResourceName, req.Namespace, req.StorageGB)
	case "loadbalancer":
		rc = calc.CalculateLoadBalancerCost(req.ResourceName, req.Namespace, req.NetworkGB)
	default:
		http.Error(w, "unknown resource_type: "+req.ResourceType, http.StatusBadRequest)
		return
	}

	jsonOK(w, rc)
}

// ─── Per-resource optimization ────────────────────────────────────────────────

func (s *Server) handleOptimize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ResourceType    string  `json:"resource_type"`
		ResourceName    string  `json:"resource_name"`
		Namespace       string  `json:"namespace,omitempty"`
		RequestedCPU    float64 `json:"requested_cpu,omitempty"`
		ActualCPU       float64 `json:"actual_cpu,omitempty"`
		RequestedMemory float64 `json:"requested_memory,omitempty"`
		ActualMemory    float64 `json:"actual_memory,omitempty"`
		TotalCPU        float64 `json:"total_cpu,omitempty"`
		UsedCPU         float64 `json:"used_cpu,omitempty"`
		TotalMemory     float64 `json:"total_memory,omitempty"`
		UsedMemory      float64 `json:"used_memory,omitempty"`
		SizeGB          float64 `json:"size_gb,omitempty"`
		UsedGB          float64 `json:"used_gb,omitempty"`
		HoursRunning    float64 `json:"hours_running,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.ResourceType == "" || req.ResourceName == "" {
		http.Error(w, "resource_type and resource_name are required", http.StatusBadRequest)
		return
	}
	if req.HoursRunning == 0 {
		req.HoursRunning = 720
	}

	var calc *cost.CostCalculator
	if s.costPipeline != nil {
		calc = cost.NewCostCalculatorWithPricing(s.costPipeline.GetPricingConfig())
	} else {
		calc = cost.NewCostCalculator(cost.ProviderGeneric)
	}
	opt := cost.NewCostOptimizer(calc)

	var opts []cost.Optimization
	switch req.ResourceType {
	case "pod":
		opts = opt.AnalyzePodOptimization(req.ResourceName, req.Namespace,
			req.RequestedCPU, req.ActualCPU, req.RequestedMemory, req.ActualMemory, req.HoursRunning)
	case "node":
		opts = opt.AnalyzeNodeOptimization(req.ResourceName, req.TotalCPU, req.UsedCPU, req.TotalMemory, req.UsedMemory)
	case "pvc":
		opts = opt.AnalyzePVCOptimization(req.ResourceName, req.Namespace, req.SizeGB, req.UsedGB)
	default:
		http.Error(w, "unknown resource_type: "+req.ResourceType, http.StatusBadRequest)
		return
	}

	jsonOK(w, map[string]interface{}{
		"optimizations": opts,
		"total_savings": opt.CalculateTotalSavings(opts),
		"count":         len(opts),
		"timestamp":     time.Now(),
	})
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

func pricingToMap(cfg cost.PricingConfig) map[string]interface{} {
	return map[string]interface{}{
		"provider":                   cfg.Provider,
		"cpu_price_per_hour":         cfg.CPUPricePerHour,
		"memory_price_per_gb_hour":   cfg.MemPricePerGBHour,
		"storage_price_per_gb_month": cfg.StoragePricePerGBMonth,
		"network_price_per_gb":       cfg.NetworkPricePerGB,
		"lb_price_per_hour":          cfg.LoadBalancerPricePerHour,
		"available_providers":        []string{"aws", "gcp", "azure", "generic"},
	}
}
