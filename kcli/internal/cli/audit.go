package cli

// audit.go — kcli audit command group.
//
// Local audit trail for kcli commands executed against the cluster.
// Records every mutating command with user, timestamp, context, and result.
// Supports compliance export for SOC2/ISO audits.
//
// Commands:
//   kcli audit log [--last=24h] [--user <u>] [--resource <r>]
//   kcli audit export [--format=csv] [--month=YYYY-MM]
//   kcli audit enable / disable

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	kcfg "github.com/kubilitics/kcli/internal/config"
	"github.com/kubilitics/kcli/internal/plugin"
	"github.com/spf13/cobra"
)

// ─── Audit types ──────────────────────────────────────────────────────────────

type auditRecord struct {
	Timestamp string `json:"timestamp"`
	User      string `json:"user"`
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
	Command   string `json:"command"`
	Args      string `json:"args"`
	Result    string `json:"result"` // success, error, skipped
	Duration  string `json:"duration_ms"`
}

type auditLog struct {
	Records []auditRecord `json:"records"`
}

// ─── Audit store ──────────────────────────────────────────────────────────────

func auditLogPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kcli", "audit.json")
}

func loadAuditLog() (*auditLog, error) {
	path := auditLogPath()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &auditLog{}, nil
		}
		return nil, err
	}
	var log auditLog
	if err := json.Unmarshal(b, &log); err != nil {
		return &auditLog{}, nil
	}
	return &log, nil
}

func saveAuditLog(log *auditLog) error {
	path := auditLogPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	// Keep last 10000 records
	if len(log.Records) > 10000 {
		log.Records = log.Records[:10000]
	}
	b, err := json.MarshalIndent(log, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// AppendAuditRecord adds a record to the audit log (exported for use from root).
func AppendAuditRecord(rec auditRecord) {
	log, err := loadAuditLog()
	if err != nil {
		return
	}
	log.Records = append([]auditRecord{rec}, log.Records...)
	_ = saveAuditLog(log)
}

// currentUser returns the OS user for audit records.
func currentUser() string {
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	if u := os.Getenv("USERNAME"); u != "" {
		return u
	}
	return "unknown"
}

// ─── newAuditCmd ──────────────────────────────────────────────────────────────

func newAuditCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "Audit trail — who ran what commands, when",
		Long: `kcli audit records every command you run against the cluster.
Tracks user, context, namespace, command, and result for compliance.

The audit log is stored locally at ~/.kcli/audit.json.
Export for SOC2/ISO compliance with kcli audit export.`,
		GroupID: "observability",
		RunE: func(cmd *cobra.Command, args []string) error {
			return newAuditLogCmd(a).RunE(cmd, args)
		},
	}

	cmd.AddCommand(
		newAuditLogCmd(a),
		newAuditExportCmd(a),
		newAuditEnableCmd(a),
		newAuditDisableCmd(a),
		newAuditStatusCmd(a),
		newAuditPluginsCmd(a),
	)
	return cmd
}

// ─── kcli audit plugins ───────────────────────────────────────────────────────

func newAuditPluginsCmd(a *app) *cobra.Command {
	var (
		pluginName string
		limit      int
		jsonOut    bool
	)
	cmd := &cobra.Command{
		Use:   "plugins",
		Short: "Show plugin execution history from ~/.kcli/audit.jsonl",
		Long: `Show the audit trail for plugin executions.

Every time a plugin is run via kcli, one JSON line is appended to
~/.kcli/audit.jsonl containing the plugin name, arguments, exit code,
duration, and sandbox platform.

Example output:
  2026-02-22T14:30:00Z  argocd    app sync        exit=0  1200ms  (sandbox:darwin)
  2026-02-22T14:35:00Z  cert-mgr  renew --all     exit=1   500ms  (sandbox:darwin)`,
		Example: `  kcli audit plugins
  kcli audit plugins --plugin argocd
  kcli audit plugins --limit 20 -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if o, _ := cmd.Flags().GetString("output"); o == "json" {
				jsonOut = true
			}

			entries, err := pluginAuditEntries()
			if err != nil {
				return err
			}

			// Filter by plugin name.
			if pluginName != "" {
				filtered := make([]plugin.PluginAuditEntry, 0, len(entries))
				kw := strings.ToLower(pluginName)
				for _, e := range entries {
					if strings.Contains(strings.ToLower(e.Name), kw) {
						filtered = append(filtered, e)
					}
				}
				entries = filtered
			}

			// Most-recent first: reverse (log is oldest-first).
			for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
				entries[i], entries[j] = entries[j], entries[i]
			}

			// Apply limit.
			if limit > 0 && len(entries) > limit {
				entries = entries[:limit]
			}

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"count":   len(entries),
					"entries": entries,
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			if len(entries) == 0 {
				fmt.Fprintln(a.stdout, "No plugin audit entries found.")
				fmt.Fprintln(a.stdout, "Plugin executions are recorded automatically when you run: kcli <plugin-name>")
				return nil
			}

			fmt.Fprintf(a.stdout, "%-24s  %-14s  %-24s  %-6s  %-8s  %s\n",
				"TIMESTAMP", "PLUGIN", "ARGS", "EXIT", "DURATION", "SANDBOX")
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))
			for _, e := range entries {
				exitStr := "0"
				if e.ExitCode != 0 {
					exitStr = fmt.Sprintf("%d", e.ExitCode)
				}
				argsStr := strings.Join(e.Args, " ")
				if len(argsStr) > 24 {
					argsStr = argsStr[:21] + "..."
				}
				sandbox := e.Sandbox
				if sandbox == "" {
					sandbox = "-"
				}
				fmt.Fprintf(a.stdout, "%-24s  %-14s  %-24s  %-6s  %5dms  %s\n",
					e.TS,
					truncate(e.Name, 14),
					truncate(argsStr, 24),
					exitStr,
					e.DurationMS,
					sandbox,
				)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&pluginName, "plugin", "", "filter by plugin name")
	cmd.Flags().IntVar(&limit, "limit", 50, "max entries to show (0 = all)")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "JSON output")
	cmd.Flags().StringP("output", "o", "", "output format (json)")
	return cmd
}

// pluginAuditEntries delegates to the plugin package's audit reader.
func pluginAuditEntries() ([]plugin.PluginAuditEntry, error) {
	return plugin.ReadPluginAuditLog()
}

// ─── kcli audit log ───────────────────────────────────────────────────────────

func newAuditLogCmd(a *app) *cobra.Command {
	var last string
	var user string
	var resource string
	var jsonOut bool
	var limit int

	cmd := &cobra.Command{
		Use:   "log",
		Short: "Show recent audit log entries",
		Example: `  kcli audit log
  kcli audit log --last=24h
  kcli audit log --user alice
  kcli audit log --resource deployment/payment-api
  kcli audit log --last=7d -o json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			log, err := loadAuditLog()
			if err != nil {
				return err
			}

			var cutoff time.Time
			if last != "" {
				dur, err := time.ParseDuration(last)
				if err == nil {
					cutoff = time.Now().Add(-dur)
				}
			}

			var filtered []auditRecord
			for _, r := range log.Records {
				if !cutoff.IsZero() {
					ts, err := time.Parse(time.RFC3339, r.Timestamp)
					if err == nil && ts.Before(cutoff) {
						continue
					}
				}
				if user != "" && !strings.Contains(strings.ToLower(r.User), strings.ToLower(user)) {
					continue
				}
				if resource != "" && !strings.Contains(strings.ToLower(r.Args), strings.ToLower(resource)) {
					continue
				}
				filtered = append(filtered, r)
				if limit > 0 && len(filtered) >= limit {
					break
				}
			}

			if jsonOut {
				b, _ := json.MarshalIndent(map[string]interface{}{
					"records": filtered,
					"count":   len(filtered),
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
				return nil
			}

			fmt.Fprintf(a.stdout, "\n%s%s kcli Audit Log%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(filtered) == 0 {
				fmt.Fprintf(a.stdout, "%s(no audit records found)%s\n\n", ansiGray, ansiReset)
				fmt.Fprintf(a.stdout, "Audit logging records mutating kcli commands automatically.\n")
				fmt.Fprintf(a.stdout, "Run any command like `kcli apply`, `kcli delete`, `kcli scale` to create records.\n\n")
				return nil
			}

			for _, r := range filtered {
				resultColor := ansiGreen
				if r.Result == "error" {
					resultColor = ansiRed
				}
				fmt.Fprintf(a.stdout, "%s%-20s%s  %-20s  kcli %s %s\n",
					ansiGray, r.Timestamp, ansiReset,
					truncate(r.User, 20),
					r.Command,
					truncate(r.Args, 50),
				)
				if r.Context != "" || r.Namespace != "" {
					fmt.Fprintf(a.stdout, "               %s[ctx:%s ns:%s] %s%s%s\n",
						ansiGray, r.Context, r.Namespace,
						resultColor, r.Result, ansiReset)
				}
			}
			fmt.Fprintf(a.stdout, "\n%s%d records%s\n\n", ansiGray, len(filtered), ansiReset)
			return nil
		},
	}
	cmd.Flags().StringVar(&last, "last", "", "Show records from last duration (e.g. 24h, 7d)")
	cmd.Flags().StringVar(&user, "user", "", "Filter by username")
	cmd.Flags().StringVar(&resource, "resource", "", "Filter by resource name")
	cmd.Flags().BoolVarP(&jsonOut, "json", "j", false, "JSON output")
	cmd.Flags().StringP("output", "o", "", "Output format (json)")
	cmd.Flags().IntVar(&limit, "limit", 100, "Maximum records to display")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o == "json" {
			jsonOut = true
		}
		return nil
	}
	return cmd
}

// ─── kcli audit export ────────────────────────────────────────────────────────

func newAuditExportCmd(a *app) *cobra.Command {
	var format string
	var month string

	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export audit log for compliance (CSV, JSON)",
		Example: `  kcli audit export --format=csv --month=2026-01 > january.csv
  kcli audit export -o json > audit-full.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			log, err := loadAuditLog()
			if err != nil {
				return err
			}

			var filtered []auditRecord
			for _, r := range log.Records {
				if month != "" {
					if !strings.HasPrefix(r.Timestamp, month) {
						continue
					}
				}
				filtered = append(filtered, r)
			}

			switch strings.ToLower(format) {
			case "csv":
				w := csv.NewWriter(a.stdout)
				_ = w.Write([]string{"timestamp", "user", "context", "namespace", "command", "args", "result", "duration_ms"})
				for _, r := range filtered {
					_ = w.Write([]string{r.Timestamp, r.User, r.Context, r.Namespace, r.Command, r.Args, r.Result, r.Duration})
				}
				w.Flush()
				return w.Error()
			default: // json
				b, _ := json.MarshalIndent(map[string]interface{}{
					"exported_at": time.Now().Format(time.RFC3339),
					"month":       month,
					"count":       len(filtered),
					"records":     filtered,
				}, "", "  ")
				fmt.Fprintln(a.stdout, string(b))
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&format, "format", "json", "Export format (json|csv)")
	cmd.Flags().StringVar(&month, "month", "", "Filter by month (YYYY-MM)")
	cmd.Flags().StringP("output", "o", "", "Output format (json|csv)")
	cmd.PreRunE = func(cmd *cobra.Command, args []string) error {
		if o, _ := cmd.Flags().GetString("output"); o != "" {
			format = o
		}
		return nil
	}
	return cmd
}

// ─── kcli audit enable/disable/status ─────────────────────────────────────────

func newAuditEnableCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "enable",
		Short: "Enable audit logging (records mutating commands to ~/.kcli/audit.json)",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			cfg.General.AuditEnabled = ptr(true)
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			a.cfg = cfg
			fmt.Fprintf(a.stdout, "%s✓ Audit logging enabled.%s\n", ansiGreen, ansiReset)
			fmt.Fprintf(a.stdout, "  Mutating commands will be recorded to ~/.kcli/audit.json\n\n")
			return nil
		},
	}
}

func newAuditDisableCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "disable",
		Short: "Disable audit logging",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			cfg.General.AuditEnabled = ptr(false)
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			a.cfg = cfg
			fmt.Fprintf(a.stdout, "%sAudit logging disabled.%s\n", ansiYellow, ansiReset)
			fmt.Fprintf(a.stdout, "  Run `kcli audit enable` to re-enable.\n\n")
			return nil
		},
	}
}

func newAuditStatusCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show audit logging status",
		RunE: func(cmd *cobra.Command, args []string) error {
			enabled := isAuditEnabled(a)
			log, _ := loadAuditLog()
			if enabled {
				fmt.Fprintf(a.stdout, "%sAudit logging: enabled%s\n", ansiGreen, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%sAudit logging: disabled%s\n", ansiYellow, ansiReset)
			}
			if log != nil {
				fmt.Fprintf(a.stdout, "%sRecords: %d%s\n", ansiGray, len(log.Records), ansiReset)
			}
			fmt.Fprintf(a.stdout, "%sLog path: ~/.kcli/audit.json%s\n\n", ansiGray, ansiReset)
			return nil
		},
	}
}

func ptr[T any](v T) *T { return &v }

func isAuditEnabled(a *app) bool {
	if strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "1" ||
		strings.TrimSpace(os.Getenv("KCLI_NO_AUDIT")) == "true" {
		return false
	}
	if a.cfg == nil {
		return true
	}
	if a.cfg.General.AuditEnabled == nil {
		return true
	}
	return *a.cfg.General.AuditEnabled
}
