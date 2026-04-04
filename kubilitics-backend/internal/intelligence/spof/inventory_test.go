package spof

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test 6: DaemonSet not flagged as SPOF, Job not flagged, StatefulSet with 1 replica flagged.
func TestDetectSPOFs_DaemonSetNeverSPOF(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "DaemonSet/kube-system/fluentd", Kind: "DaemonSet", Name: "fluentd", Replicas: 1, FanIn: 5},
	}
	results := DetectSPOFs(workloads)
	assert.Empty(t, results, "DaemonSet should never be flagged as SPOF")
}

func TestDetectSPOFs_JobNotFlagged(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "Job/default/migration", Kind: "Job", Name: "migration", Replicas: 1, FanIn: 3},
		{Key: "CronJob/default/cleanup", Kind: "CronJob", Name: "cleanup", Replicas: 1, FanIn: 2},
	}
	results := DetectSPOFs(workloads)
	assert.Empty(t, results, "Jobs and CronJobs should not be flagged as SPOF")
}

func TestDetectSPOFs_StatefulSetWithOneReplica(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "StatefulSet/default/postgres", Kind: "StatefulSet", Name: "postgres", Replicas: 1, FanIn: 4},
	}
	results := DetectSPOFs(workloads)
	require.Len(t, results, 1, "StatefulSet with 1 replica and dependents should be SPOF")
	assert.Equal(t, "StatefulSet", results[0].Kind)
	assert.Contains(t, results[0].Reason, "storage does not prevent downtime")
}

func TestDetectSPOFs_StatefulSetMultipleReplicas(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "StatefulSet/default/postgres", Kind: "StatefulSet", Name: "postgres", Replicas: 3, FanIn: 4},
	}
	results := DetectSPOFs(workloads)
	assert.Empty(t, results, "StatefulSet with 3 replicas should not be SPOF")
}

func TestDetectSPOFs_DeploymentSingleReplica(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "Deployment/default/api", Kind: "Deployment", Name: "api", Replicas: 1, FanIn: 3},
	}
	results := DetectSPOFs(workloads)
	require.Len(t, results, 1)
	assert.Equal(t, "Deployment", results[0].Kind)
}

func TestDetectSPOFs_DeploymentNoDependents(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "Deployment/default/leaf", Kind: "Deployment", Name: "leaf", Replicas: 1, FanIn: 0},
	}
	results := DetectSPOFs(workloads)
	assert.Empty(t, results, "Deployment with no dependents should not be SPOF")
}

// Test 7: HPA with implied minReplicas=1 still flags as SPOF.
func TestDetectSPOFs_HPAWithOneReplicaStillSPOF(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "Deployment/default/api", Kind: "Deployment", Name: "api", Replicas: 1, HasHPA: true, FanIn: 5},
	}
	results := DetectSPOFs(workloads)
	require.Len(t, results, 1, "HPA with minReplicas=1 (implied) should still be SPOF")
	assert.True(t, results[0].HasHPA)
	assert.Contains(t, results[0].Reason, "HPA present but minReplicas may be 1")
}

func TestDetectSPOFs_MixedWorkloads(t *testing.T) {
	workloads := []WorkloadInfo{
		{Key: "DaemonSet/kube-system/fluentd", Kind: "DaemonSet", Name: "fluentd", Replicas: 1, FanIn: 5},
		{Key: "Job/default/migration", Kind: "Job", Name: "migration", Replicas: 1, FanIn: 3},
		{Key: "StatefulSet/default/postgres", Kind: "StatefulSet", Name: "postgres", Replicas: 1, FanIn: 4},
		{Key: "Deployment/default/api", Kind: "Deployment", Name: "api", Replicas: 1, FanIn: 3},
		{Key: "Deployment/default/web", Kind: "Deployment", Name: "web", Replicas: 3, FanIn: 2},
	}
	results := DetectSPOFs(workloads)
	// Only StatefulSet/postgres and Deployment/api should be flagged
	require.Len(t, results, 2)

	kinds := make(map[string]bool)
	for _, r := range results {
		kinds[r.Kind+"/"+r.Name] = true
	}
	assert.True(t, kinds["StatefulSet/postgres"])
	assert.True(t, kinds["Deployment/api"])
}
