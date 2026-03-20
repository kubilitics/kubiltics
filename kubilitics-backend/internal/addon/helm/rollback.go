package helm

import (
	"context"
	"fmt"

	"helm.sh/helm/v3/pkg/action"
)

// Rollback runs a Helm rollback to the given revision (0 = previous revision).
func (c *helmClientImpl) Rollback(ctx context.Context, req RollbackRequest) error {
	_ = ctx
	cfg, err := c.newActionConfig(req.Namespace)
	if err != nil {
		return err
	}
	rollbackAction := action.NewRollback(cfg)
	rollbackAction.Version = req.ToRevision
	rollbackAction.Wait = req.Wait
	rollbackAction.Timeout = req.Timeout
	if err := rollbackAction.Run(req.ReleaseName); err != nil {
		return fmt.Errorf("rollback: %w", err)
	}
	return nil
}
