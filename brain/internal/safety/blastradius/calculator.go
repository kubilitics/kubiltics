package blastradius

import "context"

// Package blastradius provides blast radius calculation for impact assessment.
//
// Responsibilities:
//   - Calculate which resources would be affected by a proposed change
//   - Determine severity and scope of impact
//   - Identify downstream dependencies
//   - Assess data loss risk
//   - Support decision-making about action safety
//
// Impact Assessment Dimensions:
//
//   1. Direct Impact (immediate)
//      - The resource being changed (pod restart, scale, delete, etc.)
//      - Immediate effect: Pod termination → new pod creation
//
//   2. Dependent Impact (direct parents/children)
//      - Parent resource: Deployment → affected pods
//      - Child resources: Service → affected endpoints
//      - Sibling resources: Other pods in same deployment
//      - Linked resources: Services pointing to pods
//
//   3. Cascading Impact (transitive dependencies)
//      - Services depending on the resource
//      - Ingresses routing to the resource
//      - Consumers of the service
//      - Other services using network policies
//
//   4. Data Impact
//      - Persistent volumes attached to pod
//      - Data loss risk if deletion
//      - Backup status
//
// Blast Radius Output:
//   - affected_resources: List of all resources that would be affected
//   - affected_count: Total count
//   - severity_levels: Breakdown by severity (critical/high/medium/low)
//   - data_loss_risk: Whether data loss possible
//   - recovery_complexity: How hard to recover if goes wrong
//   - estimated_downtime: Expected service disruption duration
//
// Severity Levels:
//   - Critical: System-critical resource (API server, etcd, monitoring)
//   - High: Important user-facing service, data-bearing resource
//   - Medium: Standard service, replicable with no data
//   - Low: Test resource, single-copy non-critical
//
// Integration Points:
//   - World Model: Query topology and resource graph
//   - Safety Engine: Use blast radius for policy decisions
//   - Autonomy Controller: Inform approval requirements
//   - Recommendation Tools: Propose less impactful alternatives
//   - Audit Logger: Record impact assessments

// BlastRadiusCalculator defines the interface for impact calculation.
type BlastRadiusCalculator interface {
	// CalculateBlastRadius calculates impact of a proposed change.
	// action: the action being evaluated
	// Returns: affected_resources, impact_summary
	CalculateBlastRadius(ctx context.Context, action interface{}) ([]interface{}, interface{}, error)

	// GetAffectedResources returns list of resources affected by action.
	// groupBy: "severity" or "type"
	GetAffectedResources(ctx context.Context, action interface{}, groupBy string) ([]interface{}, error)

	// AssessDataLossRisk evaluates if action could cause data loss.
	// Returns: has_risk (bool), affected_volumes, backup_status
	AssessDataLossRisk(ctx context.Context, action interface{}) (bool, []interface{}, interface{}, error)

	// EstimateDowntime estimates service disruption duration.
	// Returns: downtime_seconds, affected_services_count
	EstimateDowntime(ctx context.Context, action interface{}) (int, int, error)

	// FindDependencies finds all resources depending on target resource.
	// Returns: direct_dependencies, transitive_dependencies
	FindDependencies(ctx context.Context, resourceID string) ([]interface{}, []interface{}, error)

	// FindDependents finds all resources that depend on target resource.
	// Returns: direct_dependents, transitive_dependents
	FindDependents(ctx context.Context, resourceID string) ([]interface{}, []interface{}, error)

	// QueryTopologyDistance calculates hops to impact from action.
	// Returns: max_hops, affected_at_each_distance
	QueryTopologyDistance(ctx context.Context, action interface{}) (int, interface{}, error)

	// CompareAlternatives compares blast radius of alternative actions.
	// Returns: comparison with original action's blast radius as baseline
	CompareAlternatives(ctx context.Context, primaryAction interface{}, alternativeActions []interface{}) (interface{}, error)
}

// NewBlastRadiusCalculator creates a new blast radius calculator.
// The concrete implementation is in calculator_impl.go.
