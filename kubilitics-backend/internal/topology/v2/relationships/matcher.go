package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// Matcher is the v2 relationship matcher interface.
// Each matcher is responsible for one or more relationship IDs from the PRD table.
type Matcher interface {
	// Name returns a stable identifier for this matcher.
	Name() string

	// Match inspects the ResourceBundle and returns zero or more topology edges.
	Match(ctx context.Context, resources *v2.ResourceBundle) ([]v2.TopologyEdge, error)
}

