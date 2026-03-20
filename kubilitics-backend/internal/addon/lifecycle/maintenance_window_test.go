package lifecycle

import (
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestIsWithinMaintenanceWindow(t *testing.T) {
	windows := []models.AddonMaintenanceWindow{
		{
			ID:              "win-1",
			ApplyTo:         "all",
			DayOfWeek:       -1, // every day
			StartHour:       20,
			StartMinute:     0,
			DurationMinutes: 120, // 20:00 - 22:00
			Timezone:        "UTC",
		},
	}

	// Case 1: Within window
	t1 := time.Date(2026, 1, 1, 21, 0, 0, 0, time.UTC)
	assert.True(t, IsWithinMaintenanceWindow(windows, "any-addon", t1))

	// Case 2: Outside window (before)
	t2 := time.Date(2026, 1, 1, 19, 59, 0, 0, time.UTC)
	assert.False(t, IsWithinMaintenanceWindow(windows, "any-addon", t2))

	// Case 3: Outside window (after)
	t3 := time.Date(2026, 1, 1, 22, 01, 0, 0, time.UTC)
	assert.False(t, IsWithinMaintenanceWindow(windows, "any-addon", t3))

	// Case 4: Specific addon check
	windows[0].ApplyTo = `["test-addon"]`
	assert.True(t, IsWithinMaintenanceWindow(windows, "test-addon", t1))
	assert.False(t, IsWithinMaintenanceWindow(windows, "other-addon", t1))
}

func TestNextWindowStart(t *testing.T) {
	w := models.AddonMaintenanceWindow{
		DayOfWeek:   int(time.Monday),
		StartHour:   2,
		StartMinute: 0,
		Timezone:    "UTC",
	}

	// If now is Sunday, next Monday 02:00 should be the result
	now := time.Date(2026, 1, 4, 10, 0, 0, 0, time.UTC) // Sunday
	next := NextWindowStart(w, now)
	assert.Equal(t, 2026, next.Year())
	assert.Equal(t, time.Month(1), next.Month())
	assert.Equal(t, 5, next.Day()) // Monday
	assert.Equal(t, 2, next.Hour())
}
