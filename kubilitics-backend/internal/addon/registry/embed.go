package registry

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed catalog/core/*.json
var coreCatalogFS embed.FS

func LoadCoreCatalog() ([]CoreCatalogFile, error) {
	entries, err := fs.ReadDir(coreCatalogFS, "catalog/core")
	if err != nil {
		return nil, fmt.Errorf("read embedded core catalog directory: %w", err)
	}

	fileNames := make([]string, 0, len(entries))
	for i := range entries {
		if entries[i].IsDir() {
			continue
		}
		if strings.HasSuffix(entries[i].Name(), ".json") {
			fileNames = append(fileNames, entries[i].Name())
		}
	}
	sort.Strings(fileNames)

	result := make([]CoreCatalogFile, 0, len(fileNames))
	for i := range fileNames {
		fullPath := filepath.ToSlash(filepath.Join("catalog/core", fileNames[i]))
		raw, readErr := coreCatalogFS.ReadFile(fullPath)
		if readErr != nil {
			return nil, fmt.Errorf("read embedded catalog file %s: %w", fileNames[i], readErr)
		}

		var file CoreCatalogFile
		if unmarshalErr := json.Unmarshal(raw, &file); unmarshalErr != nil {
			return nil, fmt.Errorf("unmarshal core catalog file %s: %w", fileNames[i], unmarshalErr)
		}
		if validateErr := ValidateCatalogFile(file); validateErr != nil {
			return nil, fmt.Errorf("validate core catalog file %s: %w", fileNames[i], validateErr)
		}

		result = append(result, file)
	}

	return result, nil
}

func ValidateCatalogFile(f CoreCatalogFile) error {
	if strings.TrimSpace(f.AddOn.ID) == "" {
		return fmt.Errorf("addon.id is required")
	}
	if strings.TrimSpace(f.AddOn.HelmChart) == "" {
		return fmt.Errorf("addon.helm_chart is required")
	}
	if strings.TrimSpace(f.AddOn.HelmRepoURL) == "" {
		return fmt.Errorf("addon.helm_repo_url is required")
	}
	if strings.TrimSpace(f.AddOn.K8sCompatMin) == "" {
		return fmt.Errorf("addon.k8s_compat_min is required")
	}
	return nil
}

// LoadCoreCatalogHash computes a deterministic SHA-256 hex digest over all embedded catalog
// JSON files (read in sorted filename order). The hash changes only when catalog content changes,
// allowing SeedOnStartup to skip the expensive DELETE+INSERT cycle on consecutive restarts.
func LoadCoreCatalogHash() (string, error) {
	entries, err := fs.ReadDir(coreCatalogFS, "catalog/core")
	if err != nil {
		return "", fmt.Errorf("read embedded core catalog directory for hash: %w", err)
	}

	fileNames := make([]string, 0, len(entries))
	for i := range entries {
		if !entries[i].IsDir() && strings.HasSuffix(entries[i].Name(), ".json") {
			fileNames = append(fileNames, entries[i].Name())
		}
	}
	sort.Strings(fileNames)

	h := sha256.New()
	for i := range fileNames {
		fullPath := filepath.ToSlash(filepath.Join("catalog/core", fileNames[i]))
		raw, readErr := coreCatalogFS.ReadFile(fullPath)
		if readErr != nil {
			return "", fmt.Errorf("read embedded catalog file %s for hash: %w", fileNames[i], readErr)
		}
		// Write filename length prefix + filename + content so that renames are detected.
		h.Write([]byte(fileNames[i]))
		h.Write(raw)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
