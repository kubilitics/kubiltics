# Integration Tests

This directory contains integration tests for the Kubilitics backend that require a real Kubernetes cluster.

## Prerequisites

1. **Test Kubernetes Cluster**: You need a running Kubernetes cluster. Options:
   - `kind` (Kubernetes in Docker): https://kind.sigs.k8s.io/
   - `k3s` (Lightweight Kubernetes): https://k3s.io/
   - `minikube`: https://minikube.sigs.k8s.io/
   - Cloud provider test cluster (GKE, EKS, AKS)

2. **kubectl**: Installed and configured with access to the test cluster

3. **Go test environment**: Go 1.23 or higher

## Running Integration Tests

```bash
# Start a test cluster (example with kind)
kind create cluster --name kubilitics-test

# Run integration tests
export KUBECONFIG=~/.kube/config
export TEST_CLUSTER_CONTEXT=kind-kubilitics-test
go test -v ./tests/integration/... -timeout 10m

# Cleanup
kind delete cluster --name kubilitics-test
```

## Test Coverage

Integration tests should cover:

1. **Cluster Connection**
   - Connect to real cluster
   - Test authentication
   - Validate API server access

2. **Resource Discovery**
   - Discover all built-in resources
   - Discover CRDs
   - Handle API server unavailability

3. **Topology Building**
   - Build topology from real cluster
   - Validate relationship inference with actual resources
   - Test with various resource configurations

4. **Real-time Updates**
   - Create/update/delete resources
   - Verify informer events
   - Test WebSocket streaming

5. **Performance**
   - Test with clusters of various sizes
   - Measure topology build time
   - Memory consumption

## Test Structure

```
tests/integration/
├── README.md (this file)
├── cluster_test.go          # Cluster connection and management
├── topology_test.go         # Topology generation with real resources
├── informer_test.go         # Real-time update watching
├── performance_test.go      # Performance with real clusters
└── fixtures/                # Sample Kubernetes manifests for testing
    ├── deployments/
    ├── services/
    └── complex-topology/
```

## Current Status

⚠️ **NOT IMPLEMENTED** - Requires access to a Kubernetes cluster which is not available in the current development environment.

To implement these tests, run them in an environment with:
- Docker (for kind)
- Or access to a cloud Kubernetes cluster
- Proper credentials and network access

## Future Work

- [ ] Implement cluster_test.go
- [ ] Implement topology_test.go with real resources
- [ ] Implement informer_test.go for real-time testing
- [ ] Add CI/CD integration with ephemeral test clusters
- [ ] Performance benchmarks against real clusters
