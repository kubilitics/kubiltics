package bootstrap

import (
	"context"
	"errors"
	"testing"

	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type fakeHub struct {
	registerOut hubclient.RegisterResponse
	registerErr error
	calls       int
}

func (f *fakeHub) Register(_ context.Context, _ hubclient.RegisterRequest) (hubclient.RegisterResponse, error) {
	f.calls++
	return f.registerOut, f.registerErr
}

type memStore struct {
	c       credstore.Creds
	loadErr error
}

func (m *memStore) Load(_ context.Context) (credstore.Creds, error) { return m.c, m.loadErr }
func (m *memStore) Save(_ context.Context, c credstore.Creds) error  { m.c = c; m.loadErr = nil; return nil }

func TestBootstrap_UsesExistingCreds(t *testing.T) {
	store := &memStore{c: credstore.Creds{ClusterID: "c1", RefreshToken: "rk_live_x", AccessToken: "eyJ", AccessTTLs: 3600}}
	hub := &fakeHub{}
	got, err := Run(context.Background(), Inputs{Store: store, Hub: hub, ClusterUID: "u", AgentVersion: "0.4.0", K8sVersion: "v"})
	if err != nil {
		t.Fatal(err)
	}
	if got.ClusterID != "c1" || hub.calls != 0 {
		t.Fatalf("did not reuse: %+v calls=%d", got, hub.calls)
	}
}

func TestBootstrap_RegistersWhenNoCreds(t *testing.T) {
	store := &memStore{loadErr: errors.New("missing")}
	hub := &fakeHub{registerOut: hubclient.RegisterResponse{ClusterID: "c2", RefreshToken: "rk_live_y", AccessToken: "eyJ", AccessTTLs: 3600}}
	got, err := Run(context.Background(), Inputs{Store: store, Hub: hub, BootstrapToken: "tok", ClusterUID: "u", AgentVersion: "0.4.0", K8sVersion: "v"})
	if err != nil {
		t.Fatal(err)
	}
	if got.ClusterID != "c2" || hub.calls != 1 {
		t.Fatal("did not register")
	}
	if store.c.ClusterID != "c2" {
		t.Fatal("did not save")
	}
}
