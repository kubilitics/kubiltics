package lifecycle

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// IsWithinMaintenanceWindow reports whether time t falls inside any window that
// applies to addonID. If no windows are defined, it returns false (no restriction).
func IsWithinMaintenanceWindow(windows []models.AddonMaintenanceWindow, addonID string, t time.Time) bool {
	for _, w := range windows {
		if !windowAppliesTo(w, addonID) {
			continue
		}
		if isInWindow(w, t) {
			return true
		}
	}
	return false
}

// NextWindowStart returns the next start time for a given window relative to now.
// It advances day-by-day until the window's day_of_week matches (or immediately
// if day_of_week == -1 and the window start time is still in the future today).
func NextWindowStart(w models.AddonMaintenanceWindow, now time.Time) time.Time {
	loc := time.UTC
	if w.Timezone != "" && w.Timezone != "UTC" {
		if l, err := time.LoadLocation(w.Timezone); err == nil {
			loc = l
		}
	}
	local := now.In(loc)

	// Candidate: today at window start time.
	candidate := time.Date(local.Year(), local.Month(), local.Day(),
		w.StartHour, w.StartMinute, 0, 0, loc)

	for i := 0; i < 8; i++ { // at most 7 days ahead
		dow := int(candidate.Weekday())
		if w.DayOfWeek == -1 || dow == w.DayOfWeek {
			if candidate.After(now) {
				return candidate.UTC()
			}
		}
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate.UTC()
}

// windowAppliesTo checks whether the window's apply_to field covers addonID.
// "all" means every addon; otherwise it is a JSON array of addon IDs.
func windowAppliesTo(w models.AddonMaintenanceWindow, addonID string) bool {
	apply := strings.TrimSpace(w.ApplyTo)
	if apply == "" || apply == "all" {
		return true
	}
	var ids []string
	if err := json.Unmarshal([]byte(apply), &ids); err != nil {
		return false
	}
	for _, id := range ids {
		if id == addonID {
			return true
		}
	}
	return false
}

// isInWindow reports whether t falls within the window's time range.
// It converts t to the window's timezone, then compares the weekday and time.
func isInWindow(w models.AddonMaintenanceWindow, t time.Time) bool {
	loc := time.UTC
	if w.Timezone != "" && w.Timezone != "UTC" {
		if l, err := time.LoadLocation(w.Timezone); err == nil {
			loc = l
		}
	}
	local := t.In(loc)

	// Day-of-week check (skip if -1 = every day).
	if w.DayOfWeek >= 0 && int(local.Weekday()) != w.DayOfWeek {
		return false
	}

	// Build window start and end for the same calendar day as t.
	windowStart := time.Date(local.Year(), local.Month(), local.Day(),
		w.StartHour, w.StartMinute, 0, 0, loc)
	windowEnd := windowStart.Add(time.Duration(w.DurationMinutes) * time.Minute)

	return !local.Before(windowStart) && local.Before(windowEnd)
}
