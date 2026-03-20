package resolver

import (
	"fmt"
	"slices"
	"strings"

	"github.com/Masterminds/semver/v3"
)

func ParseConstraint(constraint string) (*semver.Constraints, error) {
	constraint = strings.TrimSpace(constraint)
	if constraint == "" {
		return semver.NewConstraint("*")
	}
	return semver.NewConstraint(constraint)
}

func VersionSatisfies(version, constraint string) (bool, error) {
	v, err := semver.NewVersion(NormalizeVersion(version))
	if err != nil {
		return false, fmt.Errorf("parse version %q: %w", version, err)
	}
	c, err := ParseConstraint(constraint)
	if err != nil {
		return false, fmt.Errorf("parse constraint %q: %w", constraint, err)
	}
	return c.Check(v), nil
}

func FindBestVersion(available []string, constraint string) (string, error) {
	if len(available) == 0 {
		return "", fmt.Errorf("no available versions")
	}
	parsedConstraint, err := ParseConstraint(constraint)
	if err != nil {
		return "", err
	}

	valid := make([]*semver.Version, 0, len(available))
	for i := range available {
		v, parseErr := semver.NewVersion(NormalizeVersion(available[i]))
		if parseErr != nil {
			continue
		}
		if parsedConstraint.Check(v) {
			valid = append(valid, v)
		}
	}
	if len(valid) == 0 {
		return "", &ResolutionError{
			Code:    ErrVersionConflict,
			Message: fmt.Sprintf("no available version satisfies constraint %q", constraint),
		}
	}

	slices.SortFunc(valid, func(a, b *semver.Version) int {
		return b.Compare(a)
	})
	return valid[0].Original(), nil
}

func NormalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimSpace(v), "v")
}

func CompareVersions(a, b string) int {
	va, errA := semver.NewVersion(NormalizeVersion(a))
	vb, errB := semver.NewVersion(NormalizeVersion(b))
	if errA != nil && errB != nil {
		return strings.Compare(a, b)
	}
	if errA != nil {
		return -1
	}
	if errB != nil {
		return 1
	}
	return va.Compare(vb)
}
