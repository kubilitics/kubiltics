package server

import (
	"encoding/json"
	"net/http"
	"time"
)

// serverVersion is the build-time version reported by /status. It can be
// overridden via -ldflags "-X .../internal/server.serverVersion=x.y.z".
var serverVersion = "0.2.0-dev"

// StatusResponse is the payload returned by /status. It is a deliberately
// small surface intended for the kubilitics-backend `aiclient.HTTPClient`
// to probe AI process liveness and capability metadata without taking on a
// full gRPC dependency.
type StatusResponse struct {
	Status        string    `json:"status"`
	AIVersion     string    `json:"ai_version"`
	SchemaVersion string    `json:"schema_version"`
	StartedAt     time.Time `json:"started_at"`
	Now           time.Time `json:"now"`
}

// HandleStatus returns an http.HandlerFunc that reports basic AI runtime
// status. The returned handler closes over `version` so callers can wire the
// build-time version string from main without leaking globals.
func HandleStatus(version string) http.HandlerFunc {
	startedAt := time.Now().UTC()
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(StatusResponse{
			Status:        "ok",
			AIVersion:     version,
			SchemaVersion: "1.0.0",
			StartedAt:     startedAt,
			Now:           time.Now().UTC(),
		})
	}
}
