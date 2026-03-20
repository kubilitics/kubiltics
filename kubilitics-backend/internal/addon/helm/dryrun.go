package helm

import (
	"context"
	"fmt"
	"strings"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chartutil"
	"sigs.k8s.io/yaml"
)

// DryRun runs a server-side install dry-run: renders the manifest without applying.
// Returns full manifest and a parsed ResourceChange list (create/update by comparing
// with existing release resources when the release already exists).
func (c *helmClientImpl) DryRun(ctx context.Context, req InstallRequest) (*DryRunResult, error) {
	repoURL, chartName, err := parseChartRef(req.ChartRef)
	if err != nil {
		return nil, err
	}
	chart, err := c.resolveChartRef(ctx, repoURL, chartName, req.Version)
	if err != nil {
		return nil, fmt.Errorf("resolve chart: %w", err)
	}

	cfg, err := c.newActionConfig(req.Namespace)
	if err != nil {
		return nil, err
	}
	installAction := action.NewInstall(cfg)
	installAction.ReleaseName = req.ReleaseName
	installAction.Namespace = req.Namespace
	installAction.CreateNamespace = req.CreateNamespace
	installAction.DryRun = true
	installAction.ClientOnly = false
	installAction.DryRunOption = "server"

	vals := req.Values
	if vals == nil {
		vals = make(map[string]interface{})
	}
	coalesced, err := chartutil.CoalesceValues(chart, vals)
	if err != nil {
		return nil, fmt.Errorf("coalesce values: %w", err)
	}

	rel, err := installAction.RunWithContext(ctx, chart, coalesced)
	if err != nil {
		return nil, fmt.Errorf("dry-run: %w", err)
	}

	diff, count := parseManifestToResourceDiff(rel.Manifest)
	if rel.Namespace != "" && rel.Name != "" {
		statusAction := action.NewStatus(cfg)
		existing, err := statusAction.Run(rel.Name)
		if err == nil && existing != nil && existing.Manifest != "" {
			diff = computeResourceDiff(existing.Manifest, rel.Manifest)
			count = len(diff)
		}
	}

	return &DryRunResult{
		Manifest:      rel.Manifest,
		Notes:         "",
		ResourceCount: count,
		ResourceDiff:  diff,
	}, nil
}

// parseManifestToResourceDiff parses a multi-document YAML manifest into ResourceChange list (all "create").
func parseManifestToResourceDiff(manifest string) ([]ResourceChange, int) {
	if manifest == "" {
		return nil, 0
	}
	docs := splitYAMLDocuments(manifest)
	out := make([]ResourceChange, 0, len(docs))
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var meta struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		}
		if err := yaml.Unmarshal([]byte(doc), &meta); err != nil {
			continue
		}
		if meta.Kind == "" {
			continue
		}
		out = append(out, ResourceChange{
			Action:    "create",
			Kind:      meta.Kind,
			Namespace: meta.Metadata.Namespace,
			Name:      meta.Metadata.Name,
		})
	}
	return out, len(out)
}

func splitYAMLDocuments(manifest string) []string {
	const sep = "\n---"
	var out []string
	for {
		idx := strings.Index(manifest, sep)
		if idx == -1 {
			if strings.TrimSpace(manifest) != "" {
				out = append(out, manifest)
			}
			break
		}
		out = append(out, manifest[:idx])
		manifest = manifest[idx+len(sep):]
	}
	return out
}

// computeResourceDiff compares existing and new manifests and returns ResourceChange list
// with action "create", "update", or "delete" (we only return create/update for dry-run output).
func computeResourceDiff(existingManifest, newManifest string) []ResourceChange {
	existingKeys := manifestResourceKeys(existingManifest)
	seen := make(map[string]struct{})
	var out []ResourceChange
	for _, doc := range splitYAMLDocuments(newManifest) {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var meta struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		}
		if err := yaml.Unmarshal([]byte(doc), &meta); err != nil {
			continue
		}
		if meta.Kind == "" {
			continue
		}
		key := resourceKey(meta.Metadata.Namespace, meta.Kind, meta.Metadata.Name)
		action := "create"
		if _, exists := existingKeys[key]; exists {
			action = "update"
		}
		seen[key] = struct{}{}
		out = append(out, ResourceChange{
			Action:    action,
			Kind:      meta.Kind,
			Namespace: meta.Metadata.Namespace,
			Name:      meta.Metadata.Name,
		})
	}
	for key := range existingKeys {
		if _, inNew := seen[key]; !inNew {
			ns, kind, name := parseResourceKey(key)
			out = append(out, ResourceChange{
				Action:    "delete",
				Kind:      kind,
				Namespace: ns,
				Name:      name,
			})
		}
	}
	return out
}

func manifestResourceKeys(manifest string) map[string]struct{} {
	m := make(map[string]struct{})
	for _, doc := range splitYAMLDocuments(manifest) {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var meta struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		}
		if err := yaml.Unmarshal([]byte(doc), &meta); err != nil {
			continue
		}
		if meta.Kind == "" {
			continue
		}
		m[resourceKey(meta.Metadata.Namespace, meta.Kind, meta.Metadata.Name)] = struct{}{}
	}
	return m
}

func resourceKey(ns, kind, name string) string {
	if ns == "" {
		ns = "default"
	}
	return ns + "/" + kind + "/" + name
}

func parseResourceKey(key string) (ns, kind, name string) {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) < 3 {
		return "", "", ""
	}
	return parts[0], parts[1], parts[2]
}
