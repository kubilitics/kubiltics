package scanner

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestChartSignatureChecker_Run(t *testing.T) {
	ctx := context.Background()
	checker := NewChartSignatureChecker(nil, nil)

	// Case 1: Nil addon detail
	res, err := checker.Run(ctx, CheckInput{})
	assert.NoError(t, err)
	assert.Nil(t, res)

	// Case 2: No digest
	inputNoDigest := CheckInput{
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{Name: "test-addon"},
		},
	}
	res, err = checker.Run(ctx, inputNoDigest)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightWARN, res[0].Status)
	assert.Contains(t, res[0].Detail, "No chart digest")

	// Case 3: With digest
	inputWithDigest := CheckInput{
		AddonDetail: &models.AddOnDetail{
			AddOnEntry: models.AddOnEntry{Name: "test-addon", ChartDigest: "sha256:12345"},
		},
	}
	res, err = checker.Run(ctx, inputWithDigest)
	assert.NoError(t, err)
	assert.Len(t, res, 1)
	assert.Equal(t, models.PreflightGO, res[0].Status)
	assert.Contains(t, res[0].Detail, "12345")
}
