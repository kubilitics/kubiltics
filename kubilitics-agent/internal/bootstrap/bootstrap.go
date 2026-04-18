package bootstrap

import (
	"context"

	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

type HubAPI interface {
	Register(ctx context.Context, req hubclient.RegisterRequest) (hubclient.RegisterResponse, error)
}

type Storage interface {
	Load(ctx context.Context) (credstore.Creds, error)
	Save(ctx context.Context, c credstore.Creds) error
}

type Inputs struct {
	Store          Storage
	Hub            HubAPI
	BootstrapToken string // for remote
	SAToken        string // for same-cluster
	ClusterUID     string
	ClusterName    string
	AgentVersion   string
	K8sVersion     string
	NodeCount      int
}

func Run(ctx context.Context, in Inputs) (credstore.Creds, error) {
	if c, err := in.Store.Load(ctx); err == nil {
		return c, nil
	}
	resp, err := in.Hub.Register(ctx, hubclient.RegisterRequest{
		BootstrapToken: in.BootstrapToken, SAToken: in.SAToken,
		ClusterUID: in.ClusterUID, ClusterName: in.ClusterName,
		AgentVersion: in.AgentVersion, K8sVersion: in.K8sVersion, NodeCount: in.NodeCount,
	})
	if err != nil {
		return credstore.Creds{}, err
	}
	creds := credstore.Creds{
		ClusterID: resp.ClusterID, RefreshToken: resp.RefreshToken,
		AccessToken: resp.AccessToken, AccessTTLs: resp.AccessTTLs,
	}
	if err := in.Store.Save(ctx, creds); err != nil {
		return credstore.Creds{}, err
	}
	return creds, nil
}
