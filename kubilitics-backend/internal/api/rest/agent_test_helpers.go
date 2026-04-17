package rest

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const defaultOrgID = "00000000-0000-0000-0000-000000000001"

// newTestAgentRepo opens an in-memory SQLite, applies all migrations,
// and returns an *AgentRepo.
func newTestAgentRepo(t *testing.T) *repository.AgentRepo {
	t.Helper()
	db := repository.NewTestDB(t)
	return repository.NewAgentRepo(db)
}

type fakeReviewer struct {
	authed   bool
	username string
}

func (f fakeReviewer) Review(_ context.Context, _ string) (k8s.ReviewResult, error) {
	return k8s.ReviewResult{Authenticated: f.authed, Username: f.username}, nil
}
