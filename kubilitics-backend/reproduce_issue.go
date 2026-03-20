//go:build ignore

package main

import (
	"context"
	"fmt"
	"log"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
)

func main() {
	ctx := context.Background()

	// Create client for default cluster (docker-desktop)
	client, err := k8s.NewClient("", "docker-desktop")
	if err != nil {
		log.Fatal(err)
	}

	yaml := `
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: test-sc-405
provisioner: kubernetes.io/no-provisioner
`

	applied, err := client.ApplyYAML(ctx, yaml)
	if err != nil {
		fmt.Printf("ERROR: %v\n", err)
		return
	}

	for _, r := range applied {
		fmt.Printf("Applied: %s/%s in %s (%s)\n", r.Kind, r.Name, r.Namespace, r.Action)
	}
}
