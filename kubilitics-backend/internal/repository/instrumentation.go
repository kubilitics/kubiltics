package repository

import (
	"context"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
)

// instrumentQuery wraps a database query with timing metrics
func instrumentQuery(operation string, fn func() error) error {
	start := time.Now()
	err := fn()
	duration := time.Since(start).Seconds()
	
	metrics.DBQueryDurationSeconds.WithLabelValues(operation).Observe(duration)
	return err
}

// instrumentQueryContext wraps a database query with timing metrics and context
func instrumentQueryContext(ctx context.Context, operation string, fn func() error) error {
	return instrumentQuery(operation, fn)
}
