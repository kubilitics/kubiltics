package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	corev1clients "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/kubilitics/kubilitics-agent/internal/bootstrap"
	"github.com/kubilitics/kubilitics-agent/internal/clusteruid"
	"github.com/kubilitics/kubilitics-agent/internal/config"
	"github.com/kubilitics/kubilitics-agent/internal/credstore"
	"github.com/kubilitics/kubilitics-agent/internal/heartbeat"
	"github.com/kubilitics/kubilitics-agent/internal/hubclient"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatal(err)
	}

	rcfg, err := rest.InClusterConfig()
	if err != nil {
		log.Fatalf("in-cluster config: %v", err)
	}
	cs, err := corev1clients.NewForConfig(rcfg)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	uid, err := clusteruid.Read(ctx, cs)
	if err != nil {
		log.Fatalf("read kube-system UID: %v", err)
	}

	store := credstore.New(cs, cfg.CredsNamespace, cfg.CredsSecretName)
	hub, err := hubclient.New(cfg.HubURL, cfg.CABundlePath, cfg.InsecureSkipTLS)
	if err != nil {
		log.Fatal(err)
	}

	saToken := readSAToken()
	creds, err := bootstrap.Run(ctx, bootstrap.Inputs{
		Store:          store,
		Hub:            hub,
		BootstrapToken: cfg.BootstrapToken,
		SAToken:        saToken,
		ClusterUID:     uid,
		AgentVersion:   cfg.AgentVersion,
	})
	if err != nil {
		log.Fatalf("registration failed: %v", err)
	}

	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
		<-c
		cancel()
	}()

	l := heartbeat.New(heartbeat.Inputs{
		Hub:          hub,
		Interval:     cfg.HeartbeatInterval,
		ClusterID:    creds.ClusterID,
		ClusterUID:   uid,
		AgentVersion: cfg.AgentVersion,
	})
	l.RunWithCreds(ctx, creds.RefreshToken, creds.AccessToken)
}

func readSAToken() string {
	b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return ""
	}
	return string(b)
}
