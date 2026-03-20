package grpc

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"

	pb "github.com/kubilitics/kubilitics-backend/api/grpc/v1"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// defaultResourceTypes is the set of resource types returned when the caller
// does not specify ResourceTypes in a StreamRequest.
var defaultResourceTypes = []string{
	"Pod", "Node", "Service", "Deployment",
	"StatefulSet", "DaemonSet", "Job", "CronJob",
	"ConfigMap", "ReplicaSet",
}

// clusterDataService implements the ClusterDataService gRPC service
type clusterDataService struct {
	pb.UnimplementedClusterDataServiceServer
	clusterService  service.ClusterService
	topologyService service.TopologyService
	metricsService  service.MetricsService
	log             *slog.Logger

	// Stream management
	mu      sync.RWMutex
	streams map[string][]chan *pb.ClusterStateEvent
}

// newClusterDataService creates a new ClusterDataService implementation
func newClusterDataService(clusterService service.ClusterService, topologyService service.TopologyService, metricsService service.MetricsService, log *slog.Logger) *clusterDataService {
	return &clusterDataService{
		clusterService:  clusterService,
		topologyService: topologyService,
		metricsService:  metricsService,
		log:             log,
		streams:         make(map[string][]chan *pb.ClusterStateEvent),
	}
}

// StreamClusterState streams real-time cluster state updates.
//
// Lifecycle:
//  1. Send an initial snapshot of every requested resource type.
//  2. Forward any events pushed into the per-stream channel by future
//     informer integration (channel is registered but not yet fed externally).
//  3. Emit a periodic "HEARTBEAT" synthetic event every 30 s so the client
//     can detect a live connection without needing an external ping.
func (s *clusterDataService) StreamClusterState(req *pb.StreamRequest, stream pb.ClusterDataService_StreamClusterStateServer) error {
	s.log.Info("StreamClusterState started",
		"cluster_id", req.ClusterId,
		"namespaces", req.Namespaces,
		"resource_types", req.ResourceTypes,
	)

	// Create event channel for this stream
	eventCh := make(chan *pb.ClusterStateEvent, 100)
	streamID := fmt.Sprintf("%s-%d", req.ClusterId, time.Now().UnixNano())

	// Register stream so future informer goroutines can push events here
	s.mu.Lock()
	s.streams[streamID] = append(s.streams[streamID], eventCh)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.streams, streamID)
		s.mu.Unlock()
		close(eventCh)
		s.log.Info("StreamClusterState stopped", "stream_id", streamID)
	}()

	// 1. Initial snapshot
	if err := s.sendInitialSnapshot(stream, req); err != nil {
		return status.Errorf(codes.Internal, "failed to send initial snapshot: %v", err)
	}

	// 2. Event + heartbeat loop
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				return nil
			}
			if err := stream.Send(event); err != nil {
				s.log.Error("Failed to send event", "error", err, "stream_id", streamID)
				return status.Errorf(codes.Internal, "failed to send event: %v", err)
			}

		case <-heartbeat.C:
			// Send a lightweight synthetic event so the client knows the
			// connection is alive. Type UNKNOWN is re-used as a heartbeat
			// signal; clients should ignore unknown event types gracefully.
			hb := &pb.ClusterStateEvent{
				Type:      pb.ClusterStateEvent_UNKNOWN,
				Timestamp: time.Now().Unix(),
				Name:      "__heartbeat__",
			}
			if err := stream.Send(hb); err != nil {
				s.log.Warn("Failed to send heartbeat, closing stream", "error", err, "stream_id", streamID)
				return status.Errorf(codes.Internal, "heartbeat failed: %v", err)
			}

		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

// sendInitialSnapshot sends the current state of all resources as CREATE events.
func (s *clusterDataService) sendInitialSnapshot(stream pb.ClusterDataService_StreamClusterStateServer, req *pb.StreamRequest) error {
	ctx := stream.Context()

	resourceTypes := req.ResourceTypes
	if len(resourceTypes) == 0 {
		resourceTypes = defaultResourceTypes
	}

	for _, resourceType := range resourceTypes {
		listReq := &pb.ListResourcesRequest{
			ClusterId:    req.ClusterId,
			ResourceType: resourceType,
			Namespace:    "", // all namespaces
		}

		listResp, err := s.ListResources(ctx, listReq)
		if err != nil {
			// Non-fatal: log and skip this resource type
			s.log.Warn("Failed to list resources for snapshot",
				"resource_type", resourceType,
				"cluster_id", req.ClusterId,
				"error", err,
			)
			continue
		}

		for _, res := range listResp.Resources {
			event := &pb.ClusterStateEvent{
				Type:         pb.ClusterStateEvent_CREATE,
				ResourceType: res.ResourceType,
				Namespace:    res.Namespace,
				Name:         res.Name,
				Uid:          res.Uid,
				Timestamp:    time.Now().Unix(),
				Data:         res.Data,
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}

	s.log.Info("Initial snapshot sent",
		"cluster_id", req.ClusterId,
		"resource_types", len(resourceTypes),
	)
	return nil
}

// GetResource retrieves a single resource by type, namespace, and name.
// Supports: Pod, Node, Service, Deployment, StatefulSet, DaemonSet,
//
//	Job, CronJob, ConfigMap, ReplicaSet.
func (s *clusterDataService) GetResource(ctx context.Context, req *pb.GetResourceRequest) (*pb.ResourceResponse, error) {
	s.log.Debug("GetResource",
		"cluster_id", req.ClusterId,
		"type", req.ResourceType,
		"namespace", req.Namespace,
		"name", req.Name,
	)

	client, err := s.clusterService.GetClient(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	var resourceData interface{}
	var uid string

	ns := req.Namespace
	name := req.Name

	switch req.ResourceType {
	case "Pod":
		obj, err := client.Clientset.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "pod not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "Node":
		obj, err := client.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "node not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "Service":
		obj, err := client.Clientset.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "service not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "Deployment":
		obj, err := client.Clientset.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "deployment not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "StatefulSet":
		obj, err := client.Clientset.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "statefulset not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "DaemonSet":
		obj, err := client.Clientset.AppsV1().DaemonSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "daemonset not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "Job":
		obj, err := client.Clientset.BatchV1().Jobs(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "job not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "CronJob":
		obj, err := client.Clientset.BatchV1().CronJobs(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "cronjob not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "ConfigMap":
		obj, err := client.Clientset.CoreV1().ConfigMaps(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "configmap not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	case "ReplicaSet":
		obj, err := client.Clientset.AppsV1().ReplicaSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "replicaset not found: %v", err)
		}
		resourceData, uid = obj, string(obj.UID)

	default:
		return nil, status.Errorf(codes.InvalidArgument, "unsupported resource type: %q (supported: Pod Node Service Deployment StatefulSet DaemonSet Job CronJob ConfigMap ReplicaSet)", req.ResourceType)
	}

	dataJSON, err := json.Marshal(resourceData)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to marshal %s %s/%s: %v", req.ResourceType, ns, name, err)
	}

	return &pb.ResourceResponse{
		ResourceType: req.ResourceType,
		Namespace:    ns,
		Name:         name,
		Uid:          uid,
		Data:         string(dataJSON),
	}, nil
}

// ListResources lists all resources of the given type.
// Supports: Pod, Node, Service, Deployment, StatefulSet, DaemonSet,
//
//	Job, CronJob, ConfigMap, ReplicaSet.
func (s *clusterDataService) ListResources(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListResourcesResponse, error) {
	s.log.Debug("ListResources",
		"cluster_id", req.ClusterId,
		"type", req.ResourceType,
		"namespace", req.Namespace,
	)

	client, err := s.clusterService.GetClient(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	ns := req.Namespace
	var resources []*pb.ResourceResponse

	switch req.ResourceType {
	case "Pod":
		list, err := client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list pods: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal Pod", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "Pod",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "Node":
		list, err := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list nodes: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal Node", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "Node",
				Namespace:    "",
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "Service":
		list, err := client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list services: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal Service", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "Service",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "Deployment":
		list, err := client.Clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list deployments: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal Deployment", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "Deployment",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "StatefulSet":
		list, err := client.Clientset.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list statefulsets: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal StatefulSet", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "StatefulSet",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "DaemonSet":
		list, err := client.Clientset.AppsV1().DaemonSets(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list daemonsets: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal DaemonSet", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "DaemonSet",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "Job":
		list, err := client.Clientset.BatchV1().Jobs(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list jobs: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal Job", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "Job",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "CronJob":
		list, err := client.Clientset.BatchV1().CronJobs(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list cronjobs: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal CronJob", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "CronJob",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "ConfigMap":
		list, err := client.Clientset.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list configmaps: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal ConfigMap", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "ConfigMap",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	case "ReplicaSet":
		list, err := client.Clientset.AppsV1().ReplicaSets(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to list replicasets: %v", err)
		}
		for i := range list.Items {
			obj := &list.Items[i]
			dataJSON, err := json.Marshal(obj)
			if err != nil {
				s.log.Warn("Failed to marshal ReplicaSet", "name", obj.Name, "error", err)
				continue
			}
			resources = append(resources, &pb.ResourceResponse{
				ResourceType: "ReplicaSet",
				Namespace:    obj.Namespace,
				Name:         obj.Name,
				Uid:          string(obj.UID),
				Data:         string(dataJSON),
			})
		}

	default:
		return nil, status.Errorf(codes.InvalidArgument,
			"unsupported resource type: %q (supported: Pod Node Service Deployment StatefulSet DaemonSet Job CronJob ConfigMap ReplicaSet)",
			req.ResourceType)
	}

	return &pb.ListResourcesResponse{
		Resources:  resources,
		TotalCount: int32(len(resources)),
	}, nil
}

// GetTopologyGraph returns the full topology graph
func (s *clusterDataService) GetTopologyGraph(ctx context.Context, req *pb.TopologyRequest) (*pb.TopologyResponse, error) {
	s.log.Debug("GetTopologyGraph", "cluster_id", req.ClusterId, "namespace", req.Namespace)

	filters := models.TopologyFilters{Namespace: strings.TrimSpace(req.Namespace)}
	graph, err := s.topologyService.GetTopology(ctx, req.ClusterId, filters, 0, false)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build topology: %v", err)
	}
	if graph == nil {
		return &pb.TopologyResponse{Nodes: []*pb.TopologyNode{}, Edges: []*pb.TopologyEdge{}}, nil
	}

	nodes := make([]*pb.TopologyNode, 0, len(graph.Nodes))
	for _, n := range graph.Nodes {
		meta := make(map[string]string)
		for k, v := range n.Metadata.Labels {
			meta[k] = v
		}
		for k, v := range n.Metadata.Annotations {
			meta["annotation."+k] = v
		}
		if n.Metadata.UID != "" {
			meta["uid"] = n.Metadata.UID
		}
		statusStr := n.Computed.Health
		if statusStr == "" {
			statusStr = n.Status
		}
		nodes = append(nodes, &pb.TopologyNode{
			Id:        n.ID,
			Type:      n.Kind,
			Name:      n.Name,
			Namespace: n.Namespace,
			Status:    statusStr,
			Metadata:  meta,
		})
	}

	edges := make([]*pb.TopologyEdge, 0, len(graph.Edges))
	for _, e := range graph.Edges {
		edges = append(edges, &pb.TopologyEdge{
			SourceId:     e.Source,
			TargetId:     e.Target,
			Relationship: e.RelationshipType,
		})
	}

	return &pb.TopologyResponse{Nodes: nodes, Edges: edges}, nil
}

// GetClusterHealth returns cluster health metrics
func (s *clusterDataService) GetClusterHealth(ctx context.Context, req *pb.HealthRequest) (*pb.HealthResponse, error) {
	s.log.Debug("GetClusterHealth", "cluster_id", req.ClusterId)

	client, err := s.clusterService.GetClient(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	nodes, err := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list nodes: %v", err)
	}

	healthyNodes := 0
	for _, node := range nodes.Items {
		for _, cond := range node.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				healthyNodes++
				break
			}
		}
	}

	pods, err := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list pods: %v", err)
	}

	healthyPods := 0
	for _, pod := range pods.Items {
		if pod.Status.Phase == "Running" {
			healthyPods++
		}
	}

	healthStatus := "healthy"
	if healthyNodes < len(nodes.Items) || (len(pods.Items) > 0 && healthyPods < len(pods.Items)/2) {
		healthStatus = "degraded"
	}

	return &pb.HealthResponse{
		Status:       healthStatus,
		HealthyNodes: int32(healthyNodes),
		TotalNodes:   int32(len(nodes.Items)),
		HealthyPods:  int32(healthyPods),
		TotalPods:    int32(len(pods.Items)),
		Issues:       []*pb.HealthIssue{},
	}, nil
}

// GetMetrics returns resource metrics for a Pod or Node.
func (s *clusterDataService) GetMetrics(ctx context.Context, req *pb.MetricsRequest) (*pb.MetricsResponse, error) {
	s.log.Debug("GetMetrics",
		"cluster_id", req.ClusterId,
		"type", req.ResourceType,
		"namespace", req.Namespace,
		"name", req.Name,
	)

	client, err := s.clusterService.GetClient(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	resp := &pb.MetricsResponse{
		ResourceType: req.ResourceType,
		Namespace:    strings.TrimSpace(req.Namespace),
		Name:         strings.TrimSpace(req.Name),
		Timestamp:    time.Now().Unix(),
	}

	switch strings.TrimSpace(req.ResourceType) {
	case "Pod":
		if req.Namespace == "" || req.Name == "" {
			return nil, status.Errorf(codes.InvalidArgument, "namespace and name are required for pod metrics")
		}
		metrics, err := s.metricsService.GetPodMetricsWithClient(ctx, client, req.Namespace, req.Name)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get pod metrics: %v", err)
		}
		resp.CpuUsage = parseMillicores(metrics.CPU)
		resp.MemoryUsage = parseMemoryBytes(metrics.Memory)

	case "Node":
		if req.Name == "" {
			return nil, status.Errorf(codes.InvalidArgument, "name is required for node metrics")
		}
		metrics, err := s.metricsService.GetNodeMetricsWithClient(ctx, client, req.Name)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to get node metrics: %v", err)
		}
		resp.CpuUsage = parseMillicores(metrics.CPU)
		resp.MemoryUsage = parseMemoryBytes(metrics.Memory)

	default:
		return nil, status.Errorf(codes.InvalidArgument,
			"unsupported resource type for metrics: %q (use Pod or Node)", req.ResourceType)
	}

	return resp, nil
}

// parseMillicores converts a Kubernetes CPU quantity string to millicores.
// Accepts Kubernetes quantity format (e.g. "500m", "1", "1.5", "100000n").
func parseMillicores(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		// Fall back: strip trailing 'm' and parse as raw millicores
		s = strings.TrimSuffix(strings.ToLower(s), "m")
		if v, err2 := resource.ParseQuantity(s); err2 == nil {
			return float64(v.MilliValue())
		}
		return 0
	}
	return float64(q.MilliValue())
}

// parseMemoryBytes converts a Kubernetes memory quantity string to bytes.
// Accepts Kubernetes quantity format (e.g. "128Mi", "1Gi", "512M", "1073741824").
func parseMemoryBytes(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	q, err := resource.ParseQuantity(s)
	if err != nil {
		return 0
	}
	v, ok := q.AsInt64()
	if !ok {
		return float64(q.Value())
	}
	return float64(v)
}

// GetEvents returns Kubernetes events for a cluster, optionally scoped to a resource.
func (s *clusterDataService) GetEvents(ctx context.Context, req *pb.EventsRequest) (*pb.EventsResponse, error) {
	s.log.Debug("GetEvents",
		"cluster_id", req.ClusterId,
		"type", req.ResourceType,
		"namespace", req.Namespace,
		"name", req.Name,
	)

	client, err := s.clusterService.GetClient(req.ClusterId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	opts := metav1.ListOptions{}
	if strings.TrimSpace(req.Name) != "" {
		opts.FieldSelector = fmt.Sprintf("involvedObject.name=%s", req.Name)
	}

	events, err := client.Clientset.CoreV1().Events(strings.TrimSpace(req.Namespace)).List(ctx, opts)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list events: %v", err)
	}

	limit := int(req.Limit)
	if limit == 0 {
		limit = 100
	}

	pbEvents := make([]*pb.Event, 0, limit)
	for i, event := range events.Items {
		if i >= limit {
			break
		}
		ts := int64(0)
		if !event.LastTimestamp.IsZero() {
			ts = event.LastTimestamp.Unix()
		}
		pbEvents = append(pbEvents, &pb.Event{
			Type:      event.Type,
			Reason:    event.Reason,
			Message:   event.Message,
			Timestamp: ts,
			Count:     event.Count,
		})
	}

	return &pb.EventsResponse{Events: pbEvents}, nil
}

// ExecuteCommand executes a command in a pod container.
func (s *clusterDataService) ExecuteCommand(ctx context.Context, req *pb.CommandRequest) (*pb.CommandResponse, error) {
	s.log.Info("ExecuteCommand",
		"cluster_id", req.ClusterId,
		"namespace", req.Namespace,
		"pod", req.PodName,
		"container", req.Container,
		"command", req.Command,
	)

	clusterID := strings.TrimSpace(req.ClusterId)
	namespace := strings.TrimSpace(req.Namespace)
	podName := strings.TrimSpace(req.PodName)
	container := strings.TrimSpace(req.Container)

	if clusterID == "" || namespace == "" || podName == "" {
		return nil, status.Errorf(codes.InvalidArgument, "cluster_id, namespace, and pod_name are required")
	}
	if len(req.Command) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "command is required")
	}

	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "cluster not found: %v", err)
	}

	// Resolve container if not specified
	if container == "" {
		pod, err := client.Clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			return nil, status.Errorf(codes.NotFound, "pod not found: %v", err)
		}
		switch len(pod.Spec.Containers) {
		case 0:
			return nil, status.Errorf(codes.FailedPrecondition, "pod %s/%s has no containers", namespace, podName)
		case 1:
			container = pod.Spec.Containers[0].Name
		default:
			return nil, status.Errorf(codes.InvalidArgument,
				"container is required when pod %s/%s has multiple containers", namespace, podName)
		}
	}

	stdout, stderr, exitCode, err := execInPod(ctx, client, namespace, podName, container, req.Command)
	if err != nil {
		return &pb.CommandResponse{
			Stdout:   stdout,
			Stderr:   stderr + "\n" + err.Error(),
			ExitCode: 1,
		}, nil
	}
	return &pb.CommandResponse{
		Stdout:   stdout,
		Stderr:   stderr,
		ExitCode: exitCode,
	}, nil
}

// execInPod runs a command in a pod container and returns stdout, stderr, and exit code.
func execInPod(ctx context.Context, client *k8s.Client, namespace, podName, container string, command []string) (stdout, stderr string, exitCode int32, err error) {
	req := client.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(namespace).
		Name(podName).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   command,
			Stdin:     false,
			Stdout:    true,
			Stderr:    true,
			TTY:       false,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
	if err != nil {
		return "", "", 1, fmt.Errorf("failed to create executor: %w", err)
	}

	var outBuf, errBuf strings.Builder
	streamErr := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdout: &outBuf,
		Stderr: &errBuf,
	})

	if streamErr != nil {
		return outBuf.String(), errBuf.String(), 1, streamErr
	}
	return outBuf.String(), errBuf.String(), 0, nil
}
