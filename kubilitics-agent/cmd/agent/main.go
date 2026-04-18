package main

import (
	"log"

	"github.com/kubilitics/kubilitics-agent/internal/config"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	log.Printf("kubilitics-agent starting; hub=%s ns=%s", cfg.HubURL, cfg.CredsNamespace)
	select {}
}
