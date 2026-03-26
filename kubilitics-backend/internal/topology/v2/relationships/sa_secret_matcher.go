package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// ServiceAccountSecretMatcher produces ServiceAccount->Secret edges for both
// SA token secrets (spec.secrets[]) and image-pull secrets (spec.imagePullSecrets[]).
type ServiceAccountSecretMatcher struct{}

func (ServiceAccountSecretMatcher) Name() string { return "sa_secret" }

func (m *ServiceAccountSecretMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	// Build a lookup of secrets by namespace/name for existence checks.
	type nsName struct{ ns, name string }
	secretSet := make(map[nsName]struct{}, len(bundle.Secrets))
	for i := range bundle.Secrets {
		s := &bundle.Secrets[i]
		secretSet[nsName{s.Namespace, s.Name}] = struct{}{}
	}

	var edges []v2.TopologyEdge
	for i := range bundle.ServiceAccounts {
		sa := &bundle.ServiceAccounts[i]
		saID := v2.NodeID("ServiceAccount", sa.Namespace, sa.Name)

		// SA token secrets (secrets[]).
		for _, ref := range sa.Secrets {
			secretName := ref.Name
			if secretName == "" {
				continue
			}
			if _, ok := secretSet[nsName{sa.Namespace, secretName}]; !ok {
				continue
			}
			tgt := v2.NodeID("Secret", sa.Namespace, secretName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(saID, tgt, "sa_token"),
				Source:               saID,
				Target:               tgt,
				RelationshipType:     "sa_token",
				RelationshipCategory: "rbac",
				Label:                "token secret",
				Detail:               "secrets",
				Style:                "solid",
				Healthy:              true,
			})
		}

		// Image-pull secrets (imagePullSecrets[]).
		for _, ref := range sa.ImagePullSecrets {
			secretName := ref.Name
			if secretName == "" {
				continue
			}
			if _, ok := secretSet[nsName{sa.Namespace, secretName}]; !ok {
				continue
			}
			tgt := v2.NodeID("Secret", sa.Namespace, secretName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(saID, tgt, "sa_image_pull_secret"),
				Source:               saID,
				Target:               tgt,
				RelationshipType:     "sa_image_pull_secret",
				RelationshipCategory: "configuration",
				Label:                "image pull secret",
				Detail:               "imagePullSecrets",
				Style:                "dashed",
				Healthy:              true,
			})
		}
	}
	return edges, nil
}
