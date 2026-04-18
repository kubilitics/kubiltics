package heartbeat

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type HubAPI interface {
	Heartbeat(ctx context.Context, access string, req hubclient.HeartbeatRequest) (hubclient.HeartbeatResponse, error)
	Refresh(ctx context.Context, refresh string) (hubclient.RefreshResponse, error)
}

type Inputs struct {
	Hub          HubAPI
	Interval     time.Duration
	ClusterID    string
	ClusterUID   string
	AgentVersion string
	K8sVersion   string
}

type Loop struct{ in Inputs }

func New(in Inputs) *Loop { return &Loop{in: in} }

// RunWithCreds blocks until ctx is cancelled or the hub returns 410 (re-register).
// On 401 access_expired, it refreshes and continues. On other errors, it backs off.
func (l *Loop) RunWithCreds(ctx context.Context, refresh, access string) {
	t := time.NewTicker(l.in.Interval)
	defer t.Stop()
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		_, err := l.in.Hub.Heartbeat(ctx, access, hubclient.HeartbeatRequest{
			ClusterID: l.in.ClusterID, ClusterUID: l.in.ClusterUID,
			AgentVersion: l.in.AgentVersion, K8sVersion: l.in.K8sVersion,
			Status: "healthy",
		})
		if err == nil {
			backoff = time.Second
			continue
		}
		var apiErr *hubclient.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 && apiErr.Code == "access_expired" {
			rr, rerr := l.in.Hub.Refresh(ctx, refresh)
			if rerr == nil {
				access = rr.AccessToken
				continue
			}
		}
		if errors.As(err, &apiErr) && apiErr.Status == 410 {
			log.Printf("hub returned 410 — re-registration required")
			return
		}
		log.Printf("heartbeat error: %v (backoff %s)", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 60*time.Second {
			backoff *= 2
		}
	}
}
