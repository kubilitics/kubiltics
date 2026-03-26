package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// WorkloadRBACMatcher produces edges from workloads (Deployment, StatefulSet, DaemonSet, Job, CronJob)
// to ServiceAccounts referenced in their pod template spec.
type WorkloadRBACMatcher struct{}

func (WorkloadRBACMatcher) Name() string { return "workload_rbac" }

func (m *WorkloadRBACMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	// Deployments
	for i := range bundle.Deployments {
		dep := &bundle.Deployments[i]
		saName := dep.Spec.Template.Spec.ServiceAccountName
		if saName == "" {
			continue
		}
		src := v2.NodeID("Deployment", dep.Namespace, dep.Name)
		tgt := v2.NodeID("ServiceAccount", dep.Namespace, saName)
		edges = append(edges, makeWorkloadRBACEdge(src, tgt))
	}

	// StatefulSets
	for i := range bundle.StatefulSets {
		sts := &bundle.StatefulSets[i]
		saName := sts.Spec.Template.Spec.ServiceAccountName
		if saName == "" {
			continue
		}
		src := v2.NodeID("StatefulSet", sts.Namespace, sts.Name)
		tgt := v2.NodeID("ServiceAccount", sts.Namespace, saName)
		edges = append(edges, makeWorkloadRBACEdge(src, tgt))
	}

	// DaemonSets
	for i := range bundle.DaemonSets {
		ds := &bundle.DaemonSets[i]
		saName := ds.Spec.Template.Spec.ServiceAccountName
		if saName == "" {
			continue
		}
		src := v2.NodeID("DaemonSet", ds.Namespace, ds.Name)
		tgt := v2.NodeID("ServiceAccount", ds.Namespace, saName)
		edges = append(edges, makeWorkloadRBACEdge(src, tgt))
	}

	// Jobs
	for i := range bundle.Jobs {
		job := &bundle.Jobs[i]
		saName := job.Spec.Template.Spec.ServiceAccountName
		if saName == "" {
			continue
		}
		src := v2.NodeID("Job", job.Namespace, job.Name)
		tgt := v2.NodeID("ServiceAccount", job.Namespace, saName)
		edges = append(edges, makeWorkloadRBACEdge(src, tgt))
	}

	// CronJobs
	for i := range bundle.CronJobs {
		cj := &bundle.CronJobs[i]
		saName := cj.Spec.JobTemplate.Spec.Template.Spec.ServiceAccountName
		if saName == "" {
			continue
		}
		src := v2.NodeID("CronJob", cj.Namespace, cj.Name)
		tgt := v2.NodeID("ServiceAccount", cj.Namespace, saName)
		edges = append(edges, makeWorkloadRBACEdge(src, tgt))
	}

	return edges, nil
}

func makeWorkloadRBACEdge(source, target string) v2.TopologyEdge {
	return v2.TopologyEdge{
		ID:                   v2.EdgeID(source, target, "service_account_ref"),
		Source:               source,
		Target:               target,
		RelationshipType:     "service_account_ref",
		RelationshipCategory: "rbac",
		Label:                "uses",
		Detail:               "spec.template.spec.serviceAccountName",
		Style:                "dashed",
		Healthy:              true,
	}
}
