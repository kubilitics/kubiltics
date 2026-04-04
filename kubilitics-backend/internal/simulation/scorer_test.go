package simulation

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsSPOF_DaemonSetNever(t *testing.T) {
	assert.False(t, IsSPOF("DaemonSet", 1, false, 5), "DaemonSet should never be SPOF")
	assert.False(t, IsSPOF("DaemonSet", 0, false, 5), "DaemonSet should never be SPOF even with 0 replicas")
}

func TestIsSPOF_JobNever(t *testing.T) {
	assert.False(t, IsSPOF("Job", 1, false, 3), "Job should never be SPOF")
	assert.False(t, IsSPOF("CronJob", 1, false, 2), "CronJob should never be SPOF")
}

func TestIsSPOF_StatefulSetSingleReplica(t *testing.T) {
	assert.True(t, IsSPOF("StatefulSet", 1, false, 4), "StatefulSet with 1 replica and dependents is SPOF")
	assert.False(t, IsSPOF("StatefulSet", 3, false, 4), "StatefulSet with 3 replicas is not SPOF")
	assert.False(t, IsSPOF("StatefulSet", 1, false, 0), "StatefulSet with no dependents is not SPOF")
}

func TestIsSPOF_DeploymentWithHPA(t *testing.T) {
	// H-BE-2: HPA with implied minReplicas=1 is still SPOF
	assert.True(t, IsSPOF("Deployment", 1, true, 3), "Deployment with HPA but 1 replica is still SPOF (conservative)")
	assert.True(t, IsSPOF("Deployment", 1, false, 3), "Deployment with 1 replica and no HPA is SPOF")
	assert.False(t, IsSPOF("Deployment", 3, true, 3), "Deployment with 3 replicas is not SPOF")
	assert.False(t, IsSPOF("Deployment", 1, true, 0), "Deployment with no dependents is not SPOF")
}
