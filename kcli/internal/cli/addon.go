package cli

// addon.go — kcli addon command group.
//
// Provides browsing and inspection of the Kubilitics add-on catalog
// and per-cluster install status, backed by the Kubilitics backend API.
//
// Backend URL resolution order:
//  1. --backend-url flag
//  2. KUBILITICS_BACKEND_URL env var
//  3. Default: http://localhost:8080
//
// Auth token resolution order:
//  1. --token flag
//  2. KUBILITICS_TOKEN env var
//  3. (unauthenticated — works on dev backends with no auth)
//
// Commands:
//
//	kcli addon list [--tier CORE|COMMUNITY|PRIVATE] [--search <term>] [--cluster <id>] [--json]
//	kcli addon info <addon-id> [--cluster <id>] [--json]

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Backend API response types ───────────────────────────────────────────────

type addonEntry struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	DisplayName     string   `json:"display_name"`
	Description     string   `json:"description"`
	Tier            string   `json:"tier"`
	Version         string   `json:"version"`
	HelmChartVersion string  `json:"helm_chart_version"`
	Maintainer      string   `json:"maintainer"`
	Tags            []string `json:"tags"`
	IsDeprecated    bool     `json:"is_deprecated"`
}

type addonDependency struct {
	DependsOnID    string `json:"depends_on_id"`
	DependencyType string `json:"dependency_type"`
	Reason         string `json:"reason,omitempty"`
}

type addonCostModel struct {
	ClusterTier            string  `json:"cluster_tier"`
	CPUMillicores          int     `json:"cpu_millicores"`
	MemoryMB               int     `json:"memory_mb"`
	MonthlyCoatUSDEstimate float64 `json:"monthly_cost_usd_estimate"`
}

type addonDetail struct {
	addonEntry
	Dependencies []addonDependency `json:"dependencies"`
	CostModels   []addonCostModel  `json:"cost_models"`
}

type addonInstallWithHealth struct {
	ID               string      `json:"id"`
	AddonID          string      `json:"addon_id"`
	ReleaseName      string      `json:"release_name"`
	Namespace        string      `json:"namespace"`
	InstalledVersion string      `json:"installed_version"`
	Status           string      `json:"status"`
	InstalledAt      string      `json:"installed_at"`
	UpdatedAt        string      `json:"updated_at"`
	CatalogEntry     *addonEntry `json:"catalog_entry,omitempty"`
	Health           *struct {
		HealthStatus string `json:"health_status"`
		ReadyPods    int    `json:"ready_pods"`
		TotalPods    int    `json:"total_pods"`
	} `json:"health,omitempty"`
}

// installRequest is sent to POST /clusters/{id}/addons/execute
type addonInstallRequest struct {
	AddonID         string                 `json:"addon_id"`
	ReleaseName     string                 `json:"release_name"`
	Namespace       string                 `json:"namespace"`
	Values          map[string]interface{} `json:"values"`
	CreateNamespace bool                   `json:"create_namespace"`
}

type addonInstallResult struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	InstalledVersion string `json:"installed_version"`
}

type addonUpgradeRequest struct {
	Version     string                 `json:"version,omitempty"`
	Values      map[string]interface{} `json:"values,omitempty"`
	ReuseValues bool                   `json:"reuse_values"`
}

type addonRollbackRequest struct {
	ToRevision int `json:"to_revision"`
}

type addonProgressEvent struct {
	Step      string `json:"step"`
	Message   string `json:"message"`
	Status    string `json:"status"` // pending, running, success, error, complete, failed
	Timestamp string `json:"timestamp"`
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

type addonAPIClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newAddonAPIClient(baseURL, token string) *addonAPIClient {
	return &addonAPIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *addonAPIClient) get(path string, out interface{}) error {
	req, err := http.NewRequest("GET", c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s: %w", c.baseURL+path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication required — set KUBILITICS_TOKEN or use --token")
	}
	if resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("not found: %s", path)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("backend returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *addonAPIClient) post(path string, body interface{}, out interface{}) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	// Install can take several minutes — give it a long timeout.
	httpClient := &http.Client{Timeout: 10 * time.Minute}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s: %w", c.baseURL+path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication required — set KUBILITICS_TOKEN or use --token")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("backend returned %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func (c *addonAPIClient) delete(path string) error {
	req, err := http.NewRequest("DELETE", c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s: %w", c.baseURL+path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication required — set KUBILITICS_TOKEN or use --token")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("backend returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

// postStream makes a POST request and streams the response body line-by-line (NDJSON).
// Each line is passed to lineHandler. Used for addon execute streaming.
func (c *addonAPIClient) postStream(path string, body interface{}, lineHandler func([]byte)) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/x-ndjson")

	httpClient := &http.Client{Timeout: 10 * time.Minute}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request to %s: %w", c.baseURL+path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("authentication required — set KUBILITICS_TOKEN or use --token")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("backend returned %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) > 0 {
			lineHandler(line)
		}
	}
	return scanner.Err()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func resolveBackendURL(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	if v := os.Getenv("KUBILITICS_BACKEND_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

func resolveToken(flagVal string) string {
	if flagVal != "" {
		return flagVal
	}
	return os.Getenv("KUBILITICS_TOKEN")
}

func tierLabel(tier string) string {
	switch strings.ToUpper(tier) {
	case "CORE":
		return "Verified"
	case "COMMUNITY":
		return "Community"
	case "PRIVATE":
		return "Private"
	default:
		return tier
	}
}

func addonTrunc(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

// ─── Command builder ──────────────────────────────────────────────────────────

func newAddonCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "addon",
		Short:   "Browse and install Kubilitics add-ons",
		GroupID: "workflow",
	}
	cmd.AddCommand(
		newAddonListCmd(a),
		newAddonInfoCmd(a),
		newAddonInstallCmd(a),
		newAddonStatusCmd(a),
		newAddonUpgradeCmd(a),
		newAddonRollbackCmd(a),
		newAddonUninstallCmd(a),
		newAddonPreflightCmd(a),
		newAddonAuditCmd(a),
	)
	return cmd
}

// ─── addon list ──────────────────────────────────────────────────────────────

func newAddonListCmd(a *app) *cobra.Command {
	var (
		tier       string
		search     string
		clusterID  string
		jsonOut    bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List add-ons from the catalog",
		Long: `List add-ons from the Kubilitics catalog.

Examples:
  # Show all add-ons
  kcli addon list

  # Show only Kubilitics-verified (CORE) add-ons
  kcli addon list --tier CORE

  # Search for cert-related add-ons
  kcli addon list --search cert

  # Show catalog and mark which are installed on a cluster
  kcli addon list --cluster my-cluster-id

  # JSON output for scripting
  kcli addon list --tier CORE --json`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			// Build query string
			q := url.Values{}
			if tier != "" {
				q.Set("tier", strings.ToUpper(tier))
			}
			if search != "" {
				q.Set("search", search)
			}
			apiPath := "/addons"
			if len(q) > 0 {
				apiPath += "?" + q.Encode()
			}

			var entries []addonEntry
			if err := client.get(apiPath, &entries); err != nil {
				return err
			}

			// Optionally fetch installed addons for this cluster to show install state
			installedSet := map[string]string{} // addonID → installedVersion
			if clusterID != "" {
				var installs []addonInstallWithHealth
				if err := client.get("/clusters/"+clusterID+"/addons/installed", &installs); err == nil {
					for _, inst := range installs {
						installedSet[inst.AddonID] = inst.InstalledVersion
					}
				}
			}

			if jsonOut {
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(entries)
			}

			return renderAddonList(a.stdout, entries, installedSet)
		},
	}

	cmd.Flags().StringVar(&tier, "tier", "", "filter by tier: CORE, COMMUNITY, PRIVATE")
	cmd.Flags().StringVar(&search, "search", "", "search add-on names and descriptions")
	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID to check install status")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL (default: $KUBILITICS_BACKEND_URL or http://localhost:8080)")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth (default: $KUBILITICS_TOKEN)")

	return cmd
}

func renderAddonList(w io.Writer, entries []addonEntry, installedSet map[string]string) error {
	if len(entries) == 0 {
		fmt.Fprintln(w, "No add-ons found.")
		return nil
	}

	// Header
	fmt.Fprintf(w, "%-36s  %-11s  %-10s  %-9s  %s\n",
		"NAME", "TIER", "VERSION", "INSTALLED", "DESCRIPTION")
	fmt.Fprintln(w, strings.Repeat("─", 100))

	for _, e := range entries {
		ver := e.Version
		if ver == "" {
			ver = e.HelmChartVersion
		}
		installed := ""
		if v, ok := installedSet[e.ID]; ok {
			installed = "v" + v
		}
		deprecated := ""
		if e.IsDeprecated {
			deprecated = " [deprecated]"
		}
		fmt.Fprintf(w, "%-36s  %-11s  %-10s  %-9s  %s%s\n",
			addonTrunc(e.DisplayName, 36),
			tierLabel(e.Tier),
			addonTrunc(ver, 10),
			installed,
			addonTrunc(e.Description, 48),
			deprecated,
		)
	}
	fmt.Fprintf(w, "\n%d add-on(s)\n", len(entries))
	return nil
}

// ─── addon info ──────────────────────────────────────────────────────────────

func newAddonInfoCmd(a *app) *cobra.Command {
	var (
		clusterID  string
		jsonOut    bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "info <addon-id>",
		Short: "Show detailed information about an add-on",
		Long: `Show detailed information about an add-on including dependencies and cost model.

Examples:
  # Full detail for cert-manager
  kcli addon info kubilitics/cert-manager

  # Also show install status on a cluster
  kcli addon info kubilitics/cert-manager --cluster my-cluster-id

  # JSON output
  kcli addon info kubilitics/cert-manager --json`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			addonID := args[0]
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			var detail addonDetail
			if err := client.get("/addons/"+url.PathEscape(addonID), &detail); err != nil {
				return err
			}

			// Optionally check cluster install status
			var clusterInstall *addonInstallWithHealth
			if clusterID != "" {
				var installs []addonInstallWithHealth
				if err := client.get("/clusters/"+clusterID+"/addons/installed", &installs); err == nil {
					for i := range installs {
						if installs[i].AddonID == addonID {
							clusterInstall = &installs[i]
							break
						}
					}
				}
			}

			if jsonOut {
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(detail)
			}

			return renderAddonInfo(a.stdout, detail, clusterInstall)
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID to check install status")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL (default: $KUBILITICS_BACKEND_URL or http://localhost:8080)")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth (default: $KUBILITICS_TOKEN)")

	return cmd
}

func renderAddonInfo(w io.Writer, d addonDetail, inst *addonInstallWithHealth) error {
	ver := d.Version
	if ver == "" {
		ver = d.HelmChartVersion
	}

	// ── Header ──────────────────────────────────────────────────────────────
	fmt.Fprintf(w, "\n  %s", d.DisplayName)
	if d.IsDeprecated {
		fmt.Fprint(w, "  [DEPRECATED]")
	}
	fmt.Fprintln(w)
	fmt.Fprintf(w, "  %s  ·  %s  ·  %s\n", d.ID, tierLabel(d.Tier), ver)
	if len(d.Tags) > 0 {
		fmt.Fprintf(w, "  tags: %s\n", strings.Join(d.Tags, ", "))
	}
	if d.Maintainer != "" {
		fmt.Fprintf(w, "  maintainer: %s\n", d.Maintainer)
	}

	// ── Description ─────────────────────────────────────────────────────────
	fmt.Fprintln(w)
	fmt.Fprintln(w, strings.Repeat("─", 72))
	fmt.Fprintln(w, d.Description)
	fmt.Fprintln(w, strings.Repeat("─", 72))

	// ── Cluster install status (if --cluster provided) ───────────────────────
	if inst != nil {
		fmt.Fprintln(w)
		fmt.Fprintf(w, "  Installed on cluster:  %s  (release: %s, namespace: %s)\n",
			inst.Status, inst.ReleaseName, inst.Namespace)
		fmt.Fprintf(w, "  Installed version:     %s\n", inst.InstalledVersion)
		fmt.Fprintf(w, "  Installed at:          %s\n", inst.InstalledAt)
	} else if inst == nil {
		// inst == nil means either no cluster flag or not installed
	}

	// ── Dependencies ────────────────────────────────────────────────────────
	if len(d.Dependencies) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "  DEPENDENCIES")
		for _, dep := range d.Dependencies {
			reqLabel := "optional"
			if dep.DependencyType == "required" {
				reqLabel = "required"
			}
			fmt.Fprintf(w, "    %-40s  [%s]", dep.DependsOnID, reqLabel)
			if dep.Reason != "" {
				fmt.Fprintf(w, "  — %s", dep.Reason)
			}
			fmt.Fprintln(w)
		}
	}

	// ── Cost model ──────────────────────────────────────────────────────────
	if len(d.CostModels) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "  ESTIMATED COST")
		fmt.Fprintf(w, "  %-12s  %6s  %9s  %10s  %s\n",
			"CLUSTER TIER", "CPU(m)", "MEMORY(MB)", "$/MONTH", "")
		fmt.Fprintf(w, "  %s\n", strings.Repeat("─", 52))
		for _, cm := range d.CostModels {
			fmt.Fprintf(w, "  %-12s  %6d  %9d  $%9.2f\n",
				cm.ClusterTier, cm.CPUMillicores, cm.MemoryMB, cm.MonthlyCoatUSDEstimate)
		}
	}

	fmt.Fprintln(w)
	return nil
}

// ─── addon install ────────────────────────────────────────────────────────────

func newAddonInstallCmd(a *app) *cobra.Command {
	var (
		namespace       string
		clusterID       string
		releaseName     string
		createNamespace bool
		yes             bool
		jsonOut         bool
		backendURL      string
		token           string
	)

	cmd := &cobra.Command{
		Use:   "install <addon-id>",
		Short: "Install an add-on on a cluster",
		Long: `Install an add-on on a cluster via the Kubilitics backend.

The command runs a preflight check first. If preflight status is BLOCK
the install is aborted. If status is WARN you are prompted to confirm.

Progress events are printed as they arrive from the backend.

Examples:
  kcli addon install kubilitics/cert-manager --namespace cert-manager --cluster prod
  kcli addon install kubilitics/ingress-nginx --namespace ingress-nginx --cluster dev --yes`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			addonID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required for addon install")
			}
			if namespace == "" {
				return fmt.Errorf("--namespace is required for addon install")
			}
			if releaseName == "" {
				// Default release name = last component of addon id
				parts := strings.Split(addonID, "/")
				releaseName = parts[len(parts)-1]
			}

			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			// ── Step 1: plan ──────────────────────────────────────────────
			fmt.Fprintf(a.stdout, "%s  Planning install for %s...%s\n", ansiCyan, addonID, ansiReset)
			planBody := map[string]string{
				"addon_id":  addonID,
				"namespace": namespace,
			}
			var plan map[string]interface{}
			if err := client.post("/clusters/"+clusterID+"/addons/plan", planBody, &plan); err != nil {
				return fmt.Errorf("plan: %w", err)
			}

			// ── Step 2: preflight ─────────────────────────────────────────
			fmt.Fprintf(a.stdout, "%s  Running preflight checks...%s\n", ansiCyan, ansiReset)
			preflightBody := map[string]interface{}{"plan": plan}
			var preflight map[string]interface{}
			if err := client.post("/clusters/"+clusterID+"/addons/preflight", preflightBody, &preflight); err != nil {
				return fmt.Errorf("preflight: %w", err)
			}

			overallStatus := fmt.Sprintf("%v", preflight["overall_status"])
			blockers, _ := preflight["blockers"].([]interface{})
			warnings, _ := preflight["warnings"].([]interface{})

			switch strings.ToUpper(overallStatus) {
			case "BLOCK":
				fmt.Fprintf(a.stderr, "%s✗  Preflight BLOCKED:%s\n", ansiRed, ansiReset)
				for _, b := range blockers {
					fmt.Fprintf(a.stderr, "   • %v\n", b)
				}
				return fmt.Errorf("install aborted: preflight blocked")
			case "WARN":
				fmt.Fprintf(a.stdout, "%s⚠  Preflight WARN:%s\n", ansiYellow, ansiReset)
				for _, w := range warnings {
					fmt.Fprintf(a.stdout, "   • %v\n", w)
				}
				if !yes {
					fmt.Fprint(a.stdout, "Continue anyway? [y/N] ")
					var answer string
					fmt.Fscan(a.stdin, &answer)
					if !strings.EqualFold(strings.TrimSpace(answer), "y") {
						return fmt.Errorf("install cancelled")
					}
				}
			default:
				fmt.Fprintf(a.stdout, "%s✓  Preflight GO%s\n", ansiGreen, ansiReset)
			}

			// ── Step 3: execute install ───────────────────────────────────
			fmt.Fprintf(a.stdout, "%s  Installing %s in namespace %s...%s\n",
				ansiCyan, addonID, namespace, ansiReset)

			installReq := addonInstallRequest{
				AddonID:         addonID,
				ReleaseName:     releaseName,
				Namespace:       namespace,
				Values:          map[string]interface{}{},
				CreateNamespace: createNamespace,
			}

			if jsonOut {
				var result addonInstallResult
				if err := client.post("/clusters/"+clusterID+"/addons/execute", installReq, &result); err != nil {
					return err
				}
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(result)
			}

			// Stream progress events from NDJSON response.
			var lastStatus string
			streamErr := client.postStream("/clusters/"+clusterID+"/addons/execute", installReq,
				func(line []byte) {
					var ev addonProgressEvent
					if err := json.Unmarshal(line, &ev); err != nil {
						return
					}
					lastStatus = ev.Status
					icon := addonStatusIcon(ev.Status)
					fmt.Fprintf(a.stdout, "  %s  %s\n", icon, ev.Message)
				})

			if streamErr != nil {
				// Fallback: if NDJSON stream not supported, try plain JSON
				var result addonInstallResult
				if err := client.post("/clusters/"+clusterID+"/addons/execute", installReq, &result); err != nil {
					return err
				}
				if result.Status == "INSTALLED" {
					fmt.Fprintf(a.stdout, "\n%s✓  Installed %s v%s%s\n",
						ansiGreen, addonID, result.InstalledVersion, ansiReset)
				}
				return nil
			}

			if lastStatus == "complete" || lastStatus == "success" {
				fmt.Fprintf(a.stdout, "\n%s✓  Install complete%s\n", ansiGreen, ansiReset)
			} else if lastStatus == "error" || lastStatus == "failed" {
				return fmt.Errorf("install failed — check logs with: kcli addon audit %s --cluster %s", addonID, clusterID)
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "", "namespace to install into (required)")
	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().StringVar(&releaseName, "release-name", "", "Helm release name (default: addon name)")
	cmd.Flags().BoolVar(&createNamespace, "create-namespace", true, "create namespace if it does not exist")
	cmd.Flags().BoolVar(&yes, "yes", false, "skip preflight WARN confirmation prompt")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output result as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

func addonStatusIcon(status string) string {
	switch status {
	case "success":
		return ansiGreen + "✓" + ansiReset
	case "error", "failed":
		return ansiRed + "✗" + ansiReset
	case "running":
		return ansiCyan + "→" + ansiReset
	case "complete":
		return ansiGreen + "✓" + ansiReset
	default:
		return ansiGray + "·" + ansiReset
	}
}

// ─── addon status ─────────────────────────────────────────────────────────────

func newAddonStatusCmd(a *app) *cobra.Command {
	var (
		clusterID  string
		jsonOut    bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "status [addon-id]",
		Short: "Show installed add-ons and their health on a cluster",
		Long: `Show installed add-ons and their health status on a cluster.

Examples:
  # All installed add-ons on a cluster
  kcli addon status --cluster prod

  # Status of a specific add-on
  kcli addon status kubilitics/cert-manager --cluster prod`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			var installs []addonInstallWithHealth
			if err := client.get("/clusters/"+clusterID+"/addons/installed", &installs); err != nil {
				return err
			}

			// Optional filter by addon-id
			if len(args) > 0 {
				filterID := args[0]
				filtered := installs[:0]
				for _, inst := range installs {
					if inst.AddonID == filterID {
						filtered = append(filtered, inst)
					}
				}
				installs = filtered
			}

			if jsonOut {
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(installs)
			}

			return renderAddonStatus(a.stdout, installs)
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

func renderAddonStatus(w io.Writer, installs []addonInstallWithHealth) error {
	if len(installs) == 0 {
		fmt.Fprintln(w, "No add-ons installed.")
		return nil
	}
	fmt.Fprintf(w, "%-36s  %-12s  %-11s  %-10s  %s\n",
		"ADD-ON", "STATUS", "HEALTH", "VERSION", "NAMESPACE")
	fmt.Fprintln(w, strings.Repeat("─", 90))
	for _, inst := range installs {
		statusCol := addonStatusColor(inst.Status)
		healthCol := ""
		if inst.Health != nil {
			healthCol = addonHealthColor(inst.Health.HealthStatus)
			if inst.Health.TotalPods > 0 {
				healthCol += fmt.Sprintf(" (%d/%d)", inst.Health.ReadyPods, inst.Health.TotalPods)
			}
		}
		name := inst.AddonID
		if inst.CatalogEntry != nil && inst.CatalogEntry.DisplayName != "" {
			name = inst.CatalogEntry.DisplayName
		}
		fmt.Fprintf(w, "%-36s  %-12s  %-11s  %-10s  %s\n",
			addonTrunc(name, 36),
			statusCol,
			addonTrunc(healthCol, 11),
			addonTrunc(inst.InstalledVersion, 10),
			inst.Namespace,
		)
	}
	fmt.Fprintf(w, "\n%d installed add-on(s)\n", len(installs))
	return nil
}

func addonStatusColor(status string) string {
	switch strings.ToUpper(status) {
	case "INSTALLED":
		return ansiGreen + "INSTALLED" + ansiReset
	case "DEGRADED":
		return ansiYellow + "DEGRADED" + ansiReset
	case "FAILED":
		return ansiRed + "FAILED" + ansiReset
	case "INSTALLING":
		return ansiCyan + "INSTALLING" + ansiReset
	case "UPGRADING":
		return ansiCyan + "UPGRADING" + ansiReset
	case "UNINSTALLING":
		return ansiYellow + "UNINSTALLING" + ansiReset
	default:
		return status
	}
}

func addonHealthColor(health string) string {
	switch strings.ToUpper(health) {
	case "HEALTHY":
		return ansiGreen + "HEALTHY" + ansiReset
	case "DEGRADED":
		return ansiYellow + "DEGRADED" + ansiReset
	case "UNKNOWN":
		return ansiGray + "UNKNOWN" + ansiReset
	default:
		return health
	}
}

// ─── addon upgrade ────────────────────────────────────────────────────────────

func newAddonUpgradeCmd(a *app) *cobra.Command {
	var (
		clusterID   string
		version     string
		reuseValues bool
		backendURL  string
		token       string
	)

	cmd := &cobra.Command{
		Use:   "upgrade <install-id>",
		Short: "Upgrade an installed add-on to a new version",
		Long: `Upgrade an installed add-on.

Use 'kcli addon status --cluster <id> --json' to find the install ID.

Examples:
  kcli addon upgrade <install-id> --cluster prod --version 1.14.0
  kcli addon upgrade <install-id> --cluster prod --reuse-values`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			installID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			upgradeReq := addonUpgradeRequest{
				Version:     version,
				ReuseValues: reuseValues,
			}
			fmt.Fprintf(a.stdout, "%s  Upgrading install %s...%s\n", ansiCyan, installID, ansiReset)
			if err := client.post(
				"/clusters/"+clusterID+"/addons/installed/"+installID+"/upgrade",
				upgradeReq, nil,
			); err != nil {
				return err
			}
			fmt.Fprintf(a.stdout, "%s✓  Upgrade initiated%s\n", ansiGreen, ansiReset)
			return nil
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().StringVar(&version, "version", "", "target chart version")
	cmd.Flags().BoolVar(&reuseValues, "reuse-values", true, "reuse current Helm values")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

// ─── addon rollback ───────────────────────────────────────────────────────────

func newAddonRollbackCmd(a *app) *cobra.Command {
	var (
		clusterID  string
		revision   int
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "rollback <install-id>",
		Short: "Roll back an installed add-on to a previous Helm revision",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			installID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}
			if revision <= 0 {
				return fmt.Errorf("--revision must be a positive integer")
			}
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			rollbackReq := addonRollbackRequest{ToRevision: revision}
			fmt.Fprintf(a.stdout, "%s  Rolling back install %s to revision %d...%s\n",
				ansiCyan, installID, revision, ansiReset)
			if err := client.post(
				"/clusters/"+clusterID+"/addons/installed/"+installID+"/rollback",
				rollbackReq, nil,
			); err != nil {
				return err
			}
			fmt.Fprintf(a.stdout, "%s✓  Rollback to revision %d initiated%s\n", ansiGreen, revision, ansiReset)
			return nil
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().IntVar(&revision, "revision", 0, "Helm revision to roll back to (required)")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

// ─── addon uninstall ──────────────────────────────────────────────────────────

func newAddonUninstallCmd(a *app) *cobra.Command {
	var (
		clusterID  string
		deleteCRDs bool
		yes        bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "uninstall <install-id>",
		Short: "Uninstall an add-on from a cluster",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			installID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			if !yes {
				crdNote := ""
				if deleteCRDs {
					crdNote = " (CRDs will also be deleted)"
				}
				fmt.Fprintf(a.stdout, "Uninstall install ID %s%s? [y/N] ", installID, crdNote)
				var answer string
				fmt.Fscan(a.stdin, &answer)
				if !strings.EqualFold(strings.TrimSpace(answer), "y") {
					return fmt.Errorf("uninstall cancelled")
				}
			}

			path := "/clusters/" + clusterID + "/addons/installed/" + installID
			if deleteCRDs {
				path += "?delete_crds=true"
			}
			fmt.Fprintf(a.stdout, "%s  Uninstalling %s...%s\n", ansiCyan, installID, ansiReset)
			if err := client.delete(path); err != nil {
				return err
			}
			fmt.Fprintf(a.stdout, "%s✓  Uninstall complete%s\n", ansiGreen, ansiReset)
			return nil
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().BoolVar(&deleteCRDs, "delete-crds", false, "also delete CRDs owned by this add-on")
	cmd.Flags().BoolVar(&yes, "yes", false, "skip confirmation prompt")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

// ─── addon preflight ──────────────────────────────────────────────────────────

func newAddonPreflightCmd(a *app) *cobra.Command {
	var (
		namespace  string
		clusterID  string
		jsonOut    bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "preflight <addon-id>",
		Short: "Run preflight checks for an add-on without installing",
		Long: `Run preflight checks to determine if an add-on can be installed.

Exit codes:
  0 — preflight GO or WARN
  1 — preflight BLOCK

Examples:
  kcli addon preflight kubilitics/cert-manager --namespace cert-manager --cluster prod`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			addonID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}
			if namespace == "" {
				return fmt.Errorf("--namespace is required")
			}
			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))

			planBody := map[string]string{"addon_id": addonID, "namespace": namespace}
			var plan map[string]interface{}
			if err := client.post("/clusters/"+clusterID+"/addons/plan", planBody, &plan); err != nil {
				return fmt.Errorf("plan: %w", err)
			}

			preflightBody := map[string]interface{}{"plan": plan}
			var report map[string]interface{}
			if err := client.post("/clusters/"+clusterID+"/addons/preflight", preflightBody, &report); err != nil {
				return fmt.Errorf("preflight: %w", err)
			}

			if jsonOut {
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(report)
			}
			return renderPreflightReport(a.stdout, a.stderr, report)
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "", "target namespace (required)")
	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

func renderPreflightReport(out, errOut io.Writer, report map[string]interface{}) error {
	overall := fmt.Sprintf("%v", report["overall_status"])
	checks, _ := report["checks"].([]interface{})

	switch strings.ToUpper(overall) {
	case "GO":
		fmt.Fprintf(out, "\n%s✓  Preflight GO%s — ready to install\n\n", ansiGreen, ansiReset)
	case "WARN":
		fmt.Fprintf(out, "\n%s⚠  Preflight WARN%s — install may succeed with warnings\n\n", ansiYellow, ansiReset)
	case "BLOCK":
		fmt.Fprintf(errOut, "\n%s✗  Preflight BLOCK%s — install cannot proceed\n\n", ansiRed, ansiReset)
	}

	for _, raw := range checks {
		check, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		status := fmt.Sprintf("%v", check["status"])
		title := fmt.Sprintf("%v", check["title"])
		detail := fmt.Sprintf("%v", check["detail"])

		var icon, color string
		switch strings.ToUpper(status) {
		case "GO":
			icon, color = "✓", ansiGreen
		case "WARN":
			icon, color = "⚠", ansiYellow
		case "BLOCK":
			icon, color = "✗", ansiRed
		default:
			icon, color = "·", ansiGray
		}

		fmt.Fprintf(out, "  %s%s%s  %s\n", color, icon, ansiReset, title)
		if detail != "" && detail != "<nil>" {
			fmt.Fprintf(out, "     %s%s%s\n", ansiGray, detail, ansiReset)
		}
		if res, ok := check["resolution"]; ok && res != nil && fmt.Sprintf("%v", res) != "" {
			fmt.Fprintf(out, "     %sFix: %v%s\n", ansiCyan, res, ansiReset)
		}
	}
	fmt.Fprintln(out)

	if strings.ToUpper(overall) == "BLOCK" {
		return fmt.Errorf("preflight blocked — install cannot proceed")
	}
	return nil
}

// ─── addon audit ──────────────────────────────────────────────────────────────

type addonAuditEvent struct {
	ID           string `json:"id"`
	Actor        string `json:"actor"`
	Operation    string `json:"operation"`
	OldVersion   string `json:"old_version,omitempty"`
	NewVersion   string `json:"new_version,omitempty"`
	Result       string `json:"result"`
	ErrorMessage string `json:"error_message,omitempty"`
	DurationMS   int64  `json:"duration_ms,omitempty"`
	CreatedAt    string `json:"created_at"`
}

func newAddonAuditCmd(a *app) *cobra.Command {
	var (
		clusterID  string
		since      string
		limit      int
		jsonOut    bool
		backendURL string
		token      string
	)

	cmd := &cobra.Command{
		Use:   "audit <install-id>",
		Short: "Show audit event timeline for an installed add-on",
		Long: `Show the audit event history for an installed add-on.

Requires the install ID (use 'kcli addon status --cluster <id> --json' to find it).

Examples:
  kcli addon audit <install-id> --cluster prod
  kcli addon audit <install-id> --cluster prod --since 24h
  kcli addon audit <install-id> --cluster prod --json`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			installID := args[0]
			if clusterID == "" {
				return fmt.Errorf("--cluster is required")
			}

			client := newAddonAPIClient(resolveBackendURL(backendURL), resolveToken(token))
			path := "/clusters/" + clusterID + "/addons/installed/" + installID + "/audit"
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", fmt.Sprintf("%d", limit))
			}
			if len(q) > 0 {
				path += "?" + q.Encode()
			}

			var events []addonAuditEvent
			if err := client.get(path, &events); err != nil {
				return err
			}

			if since != "" {
				dur, err := time.ParseDuration(since)
				if err != nil {
					return fmt.Errorf("--since must be a Go duration (e.g. 24h, 168h): %w", err)
				}
				cutoff := time.Now().Add(-dur)
				filtered := events[:0]
				for _, ev := range events {
					t, parseErr := time.Parse(time.RFC3339, ev.CreatedAt)
					if parseErr != nil || t.After(cutoff) {
						filtered = append(filtered, ev)
					}
				}
				events = filtered
			}

			if jsonOut {
				enc := json.NewEncoder(a.stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(events)
			}
			return renderAuditEvents(a.stdout, events)
		},
	}

	cmd.Flags().StringVar(&clusterID, "cluster", "", "cluster ID (required)")
	cmd.Flags().StringVar(&since, "since", "", "show only events within this duration (e.g. 24h, 168h)")
	cmd.Flags().IntVar(&limit, "limit", 50, "maximum number of events to show")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "output as JSON")
	cmd.Flags().StringVar(&backendURL, "backend-url", "", "Kubilitics backend URL")
	cmd.Flags().StringVar(&token, "token", "", "bearer token for backend auth")

	return cmd
}

func renderAuditEvents(w io.Writer, events []addonAuditEvent) error {
	if len(events) == 0 {
		fmt.Fprintln(w, "No audit events found.")
		return nil
	}
	fmt.Fprintf(w, "%-24s  %-12s  %-14s  %-9s  %s\n",
		"TIMESTAMP", "OPERATION", "ACTOR", "RESULT", "VERSION")
	fmt.Fprintln(w, strings.Repeat("─", 80))
	for _, ev := range events {
		resultColor := ansiGreen
		switch strings.ToLower(ev.Result) {
		case "failed", "error":
			resultColor = ansiRed
		case "in_progress":
			resultColor = ansiYellow
		}
		versionCol := ev.NewVersion
		if ev.OldVersion != "" && ev.NewVersion != "" && ev.OldVersion != ev.NewVersion {
			versionCol = ev.OldVersion + "→" + ev.NewVersion
		}
		ts := ev.CreatedAt
		if t, err := time.Parse(time.RFC3339, ev.CreatedAt); err == nil {
			ts = t.Local().Format("2006-01-02 15:04:05")
		}
		fmt.Fprintf(w, "%-24s  %-12s  %-14s  %s%-9s%s  %s\n",
			ts,
			addonTrunc(ev.Operation, 12),
			addonTrunc(ev.Actor, 14),
			resultColor, addonTrunc(ev.Result, 9), ansiReset,
			addonTrunc(versionCol, 20),
		)
		if ev.ErrorMessage != "" {
			fmt.Fprintf(w, "  %s%s%s\n", ansiRed, ev.ErrorMessage, ansiReset)
		}
	}
	fmt.Fprintf(w, "\n%d event(s)\n", len(events))
	return nil
}
