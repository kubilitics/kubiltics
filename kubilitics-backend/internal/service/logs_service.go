package service

import (
	"context"
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
)

// LogsService provides access to pod logs
type LogsService interface {
	GetPodLogs(ctx context.Context, clusterID, namespace, podName, containerName string, follow bool, tailLines int64) (io.ReadCloser, error)
	StreamPodLogs(ctx context.Context, clusterID, namespace, podName, containerName string, logChan chan<- string, errChan chan<- error)
}

type logsService struct {
	clusterService *clusterService
}

// NewLogsService creates a new logs service
func NewLogsService(cs ClusterService) LogsService {
	return &logsService{
		clusterService: cs.(*clusterService),
	}
}

func (s *logsService) GetPodLogs(ctx context.Context, clusterID, namespace, podName, containerName string, follow bool, tailLines int64) (io.ReadCloser, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}

	opts := &corev1.PodLogOptions{
		Container: containerName,
		Follow:    follow,
	}

	if tailLines > 0 {
		opts.TailLines = &tailLines
	}

	req := client.Clientset.CoreV1().Pods(namespace).GetLogs(podName, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to stream logs: %w", err)
	}

	return stream, nil
}

func (s *logsService) StreamPodLogs(ctx context.Context, clusterID, namespace, podName, containerName string, logChan chan<- string, errChan chan<- error) {
	stream, err := s.GetPodLogs(ctx, clusterID, namespace, podName, containerName, true, 100)
	if err != nil {
		errChan <- err
		return
	}
	defer stream.Close()

	buf := make([]byte, 2048)
	for {
		select {
		case <-ctx.Done():
			return
		default:
			n, err := stream.Read(buf)
			if n > 0 {
				logChan <- string(buf[:n])
			}
			if err != nil {
				if err != io.EOF {
					errChan <- err
				}
				return
			}
		}
	}
}
