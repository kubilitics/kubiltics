package lifecycle

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
	corev1 "k8s.io/api/core/v1"
)

func TestIsPodReady(t *testing.T) {
	podReady := &corev1.Pod{
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionTrue},
			},
		},
	}
	assert.True(t, isPodReady(podReady))

	podNotReady := &corev1.Pod{
		Status: corev1.PodStatus{
			Conditions: []corev1.PodCondition{
				{Type: corev1.PodReady, Status: corev1.ConditionFalse},
			},
		},
	}
	assert.False(t, isPodReady(podNotReady))

	podNoConditions := &corev1.Pod{}
	assert.False(t, isPodReady(podNoConditions))
}

func TestComputeHealthStatus(t *testing.T) {
	now := time.Now()

	// Zero total pods
	status, health := computeHealthStatus(0, 0, now)
	assert.Equal(t, models.StatusDegraded, status)
	assert.Equal(t, models.HealthUnknown, health)

	// All ready
	status, health = computeHealthStatus(3, 3, now)
	assert.Equal(t, models.StatusInstalled, status)
	assert.Equal(t, models.HealthHealthy, health)

	// Not all ready, but within degrade threshold
	status, health = computeHealthStatus(1, 3, now.Add(-time.Minute))
	assert.Equal(t, models.StatusInstalled, status)
	assert.Equal(t, models.HealthHealthy, health)

	// Not all ready, past degrade threshold
	status, health = computeHealthStatus(1, 3, now.Add(-10*time.Minute))
	assert.Equal(t, models.StatusDegraded, status)
	assert.Equal(t, models.HealthDegraded, health)
}
