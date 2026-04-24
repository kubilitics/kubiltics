// Package resilient provides the envelope shape and middleware that
// ensures every cluster-scoped endpoint degrades honestly instead of
// producing blank 5xx responses on transient cluster unreachability.
//
// See docs/architecture/2026-04-24-onboarding-v2-robustness-mega.md §5.
package resilient

import "time"

// ResilientResponse is the canonical envelope for every cluster-scoped
// endpoint. A 5xx status is RESERVED for real server bugs (panic, DB
// corruption, misconfiguration). Transient apiserver issues and cluster-
// unreachable conditions always produce HTTP 200 with Reachable=false.
type ResilientResponse[T any] struct {
	Data         T          `json:"data,omitempty"`
	Reachable    bool       `json:"reachable"`
	Stale        bool       `json:"stale,omitempty"`
	StaleAsOf    *time.Time `json:"stale_as_of,omitempty"`
	ErrorMessage string     `json:"error_message,omitempty"`
	HealthStatus string     `json:"health_status"` // healthy | unreachable | degraded
}
