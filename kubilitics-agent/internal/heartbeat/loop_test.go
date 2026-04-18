package heartbeat

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type fakeHub struct {
	hbCalls  atomic.Int32
	refCalls atomic.Int32
	hbErr    error
	refOut   hubclient.RefreshResponse
}

func (f *fakeHub) Heartbeat(_ context.Context, _ string, _ hubclient.HeartbeatRequest) (hubclient.HeartbeatResponse, error) {
	f.hbCalls.Add(1)
	return hubclient.HeartbeatResponse{Ack: true}, f.hbErr
}

func (f *fakeHub) Refresh(_ context.Context, _ string) (hubclient.RefreshResponse, error) {
	f.refCalls.Add(1)
	return f.refOut, nil
}

func TestLoop_SendsHeartbeats(t *testing.T) {
	hub := &fakeHub{}
	l := New(Inputs{Hub: hub, Interval: 20 * time.Millisecond, ClusterID: "c", ClusterUID: "u"})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	l.RunWithCreds(ctx, "rk", "eyJ")
	if hub.hbCalls.Load() < 3 {
		t.Fatalf("only %d hb", hub.hbCalls.Load())
	}
}

func TestLoop_RefreshesOnAccessExpired(t *testing.T) {
	hub := &fakeHub{
		hbErr:  &hubclient.APIError{Status: 401, Code: "access_expired"},
		refOut: hubclient.RefreshResponse{AccessToken: "new", AccessTTLs: 3600},
	}
	l := New(Inputs{Hub: hub, Interval: 10 * time.Millisecond, ClusterID: "c", ClusterUID: "u"})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	l.RunWithCreds(ctx, "rk", "eyJ")
	if hub.refCalls.Load() == 0 {
		t.Fatal("did not refresh")
	}
}
