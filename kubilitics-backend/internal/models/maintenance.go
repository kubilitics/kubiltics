package models

import (
	"fmt"
	"time"
)

// AddonMaintenanceWindow defines a recurring time window during which auto-upgrades
// are permitted. Outside the window, the lifecycle controller defers upgrades and
// records NextEligibleAt on the associated upgrade policy.
type AddonMaintenanceWindow struct {
	ID   string `json:"id"         db:"id"`
	ClusterID string `json:"cluster_id" db:"cluster_id"`
	Name      string `json:"name"       db:"name"`

	// DayOfWeek is the Go time.Weekday value (0=Sunday … 6=Saturday).
	// Use -1 to mean "every day".
	DayOfWeek int `json:"day_of_week" db:"day_of_week"`

	// StartHour and StartMinute define the window start in Timezone.
	StartHour   int    `json:"start_hour"        db:"start_hour"`
	StartMinute int    `json:"start_minute"      db:"start_minute"`
	Timezone    string `json:"timezone"          db:"timezone"`

	// DurationMinutes is how long the window stays open.
	DurationMinutes int `json:"duration_minutes" db:"duration_minutes"`

	// ApplyTo is "all" or a JSON array of addon IDs the window restricts.
	// e.g. `["cert-manager","prometheus"]`
	ApplyTo string `json:"apply_to" db:"apply_to"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// HumanSchedule returns a plain-English description of the window.
// Example: "Every Sunday at 02:00 UTC for 2 hours"
func (w AddonMaintenanceWindow) HumanSchedule() string {
	tz := w.Timezone
	if tz == "" {
		tz = "UTC"
	}
	day := "every day"
	if w.DayOfWeek >= 0 && w.DayOfWeek <= 6 {
		day = "every " + time.Weekday(w.DayOfWeek).String()
	}
	durationH := w.DurationMinutes / 60
	durationM := w.DurationMinutes % 60
	durationStr := ""
	switch {
	case durationH > 0 && durationM > 0:
		durationStr = fmt.Sprintf("%dh %dm", durationH, durationM)
	case durationH > 0:
		durationStr = fmt.Sprintf("%dh", durationH)
	default:
		durationStr = fmt.Sprintf("%dm", durationM)
	}
	return fmt.Sprintf("%s at %02d:%02d %s for %s", day, w.StartHour, w.StartMinute, tz, durationStr)
}
