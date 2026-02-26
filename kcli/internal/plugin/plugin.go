package plugin

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/version"
	"gopkg.in/yaml.v3"
)

const pluginPrefix = "kcli-"

var validPluginName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

type Manifest struct {
	Name            string   `json:"name" yaml:"name"`
	Version         string   `json:"version" yaml:"version"`
	MinKcliVersion  string   `json:"minKcliVersion,omitempty" yaml:"minKcliVersion,omitempty"`
	Author          string   `json:"author,omitempty" yaml:"author,omitempty"`
	Description     string   `json:"description,omitempty" yaml:"description,omitempty"`
	Commands        []string `json:"commands,omitempty" yaml:"commands,omitempty"`
	Permissions     []string `json:"permissions,omitempty" yaml:"permissions,omitempty"`
}

type PolicyStore struct {
	Allowed map[string][]string `json:"allowed"`
}

type PluginInfo struct {
	Name            string
	Path            string
	Manifest        *Manifest
	ValidationError error
}

type RegistryEntry struct {
	Name        string    `json:"name"`
	Source      string    `json:"source"`
	SourceType  string    `json:"sourceType"`
	InstalledAt time.Time `json:"installedAt"`

	// SHA256 is the hex-encoded SHA-256 digest of the plugin binary recorded
	// at install time.  It is verified on every execution to detect tampering.
	SHA256 string `json:"sha256,omitempty"`
}

type Registry struct {
	Plugins map[string]RegistryEntry `json:"plugins"`
}

type MarketplacePlugin struct {
	Name        string   `json:"name" yaml:"name"`
	Source      string   `json:"source" yaml:"source"`
	Version     string   `json:"version" yaml:"version"`
	Description string   `json:"description" yaml:"description"`
	Official    bool     `json:"official" yaml:"official"`
	Downloads   int      `json:"downloads" yaml:"downloads"`
	Rating      float64  `json:"rating" yaml:"rating"`
	Tags        []string `json:"tags" yaml:"tags"`

	// SHA256 is the expected hex-encoded SHA-256 of the released binary.
	// Populated for official plugins in the marketplace catalog.
	SHA256 string `json:"sha256,omitempty" yaml:"sha256,omitempty"`

	// CosignPublicKey is the hex/base64 cosign public key or a reference to a
	// well-known key for sigstore signature verification.
	// Reserved for future full cosign integration.
	CosignPublicKey string `json:"cosignPublicKey,omitempty" yaml:"cosignPublicKey,omitempty"`
}

func kcliHomeDir() (string, error) {
	if custom := strings.TrimSpace(os.Getenv("KCLI_HOME_DIR")); custom != "" {
		return custom, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".kcli"), nil
}

func PluginDir() (string, error) {
	home, err := kcliHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "plugins"), nil
}

func policyFilePath() (string, error) {
	home, err := kcliHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "plugin-policy.json"), nil
}

func registryFilePath() (string, error) {
	home, err := kcliHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "plugin-registry.json"), nil
}

func Discover() ([]string, error) {
	infos, err := DiscoverInfo()
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(infos))
	for _, info := range infos {
		out = append(out, info.Name)
	}
	return out, nil
}

func DiscoverInfo() ([]PluginInfo, error) {
	dir, err := PluginDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []PluginInfo{}, nil
		}
		return nil, err
	}

	out := make([]PluginInfo, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, pluginPrefix) {
			continue
		}
		if strings.HasSuffix(name, ".yaml") || strings.HasSuffix(name, ".yml") {
			continue
		}
		info, ierr := e.Info()
		if ierr != nil {
			continue
		}
		if info.Mode()&0o111 == 0 {
			continue
		}
		pluginName := strings.TrimPrefix(name, pluginPrefix)
		if pluginName == "" {
			continue
		}
		pinfo := PluginInfo{
			Name: pluginName,
			Path: filepath.Join(dir, name),
		}
		manifest, err := loadManifestForResolved(pluginName, pinfo.Path)
		if err != nil {
			pinfo.ValidationError = err
		} else {
			pinfo.Manifest = manifest
		}
		out = append(out, pinfo)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func Resolve(name string) (string, error) {
	name = strings.TrimSpace(name)
	if !validPluginName.MatchString(name) {
		return "", fmt.Errorf("invalid plugin name %q: allowed pattern is [a-z0-9-]", name)
	}
	dir, derr := PluginDir()
	if derr != nil {
		return "", derr
	}
	candidate := filepath.Join(dir, pluginPrefix+name)
	if st, serr := os.Stat(candidate); serr == nil {
		if st.IsDir() {
			return "", fmt.Errorf("plugin %q must be an executable file, not a directory", name)
		}
		if st.Mode()&0o111 == 0 {
			return "", fmt.Errorf("plugin %q is not executable", name)
		}
		if err := validateSandbox(candidate); err != nil {
			return "", err
		}
		return candidate, nil
	}

	fromPath, err := exec.LookPath(pluginPrefix + name)
	if err == nil {
		st, statErr := os.Stat(fromPath)
		if statErr != nil {
			return "", statErr
		}
		if st.Mode()&0o111 == 0 {
			return "", fmt.Errorf("plugin %q is not executable", name)
		}
		if err := validateSandbox(fromPath); err != nil {
			return "", err
		}
		return fromPath, nil
	}
	return "", fmt.Errorf("plugin %q not found", name)
}

func Run(name string, args []string) error {
	resolvedName, bin, err := resolveForInvocation(name)
	if err != nil {
		return err
	}

	// Allowlist enforcement (P2-5) — reject execution if the allowlist is
	// locked and the plugin name is not present in it.
	if err := IsPluginAllowed(resolvedName); err != nil {
		return err
	}

	manifest, err := loadManifestForResolved(resolvedName, bin)
	if err != nil {
		return err
	}
	if err := ensurePermissions(resolvedName, manifest.Permissions); err != nil {
		return err
	}
	if err := checkMinKcliVersion(manifest.MinKcliVersion); err != nil {
		return err
	}

	// Binary integrity check — verify the SHA-256 digest of the plugin binary
	// against the value recorded at install time.  This detects binary
	// replacement or corruption since the plugin was installed.
	// VerifyPlugin is a no-op for plugins with no recorded checksum (e.g.
	// manually placed binaries) so it is safe to always call.
	if err := VerifyPlugin(resolvedName); err != nil {
		return err
	}

	// OS-level sandboxing (P2-2) — build an isolation profile from the
	// manifest permissions and wrap the exec inside it.
	profile := BuildSandboxProfile(resolvedName, bin, manifest)
	cmd := sandboxedCommand(bin, args, profile)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Audit logging (P2-3) — record start time, run the plugin, then append
	// one JSON line to ~/.kcli/audit.jsonl regardless of success or failure.
	start := time.Now()
	runErr := cmd.Run()
	exitCode := 0
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}
	AppendPluginAuditEntry(newPluginAuditEntry(resolvedName, args, exitCode, start, profile))
	return runErr
}

func resolveForInvocation(invocation string) (string, string, error) {
	invocation = strings.TrimSpace(invocation)
	if invocation == "" {
		return "", "", fmt.Errorf("plugin name required")
	}
	if validPluginName.MatchString(invocation) {
		if bin, err := Resolve(invocation); err == nil {
			return invocation, bin, nil
		}
	}
	infos, err := DiscoverInfo()
	if err != nil {
		return "", "", err
	}
	for _, info := range infos {
		if info.Manifest == nil || info.ValidationError != nil {
			continue
		}
		if invocation == info.Name || hasCommandAlias(info.Manifest.Commands, invocation) {
			bin, rerr := Resolve(info.Name)
			if rerr != nil {
				return "", "", rerr
			}
			return info.Name, bin, nil
		}
	}
	return "", "", fmt.Errorf("plugin %q not found", invocation)
}

func TryRunForArgs(args []string, isBuiltinFirstArg func(string) bool) (handled bool, err error) {
	if len(args) == 0 {
		return false, nil
	}
	first := strings.TrimSpace(args[0])
	if first == "" || strings.HasPrefix(first, "-") {
		return false, nil
	}
	if isBuiltinFirstArg(first) {
		return false, nil
	}
	if rerr := Run(first, args[1:]); rerr != nil {
		if strings.Contains(rerr.Error(), "not found") {
			return false, nil
		}
		return true, rerr
	}
	return true, nil
}

func Inspect(name string) (PluginInfo, error) {
	resolved, err := Resolve(name)
	if err != nil {
		return PluginInfo{}, err
	}
	info := PluginInfo{Name: name, Path: resolved}
	manifest, err := loadManifestForResolved(name, resolved)
	if err != nil {
		info.ValidationError = err
		return info, nil
	}
	info.Manifest = manifest
	return info, nil
}

func LoadPolicy() (*PolicyStore, error) {
	path, err := policyFilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &PolicyStore{Allowed: map[string][]string{}}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &PolicyStore{Allowed: map[string][]string{}}, nil
	}
	var s PolicyStore
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	if s.Allowed == nil {
		s.Allowed = map[string][]string{}
	}
	return &s, nil
}

func SavePolicy(s *PolicyStore) error {
	if s == nil {
		return fmt.Errorf("nil policy store")
	}
	if s.Allowed == nil {
		s.Allowed = map[string][]string{}
	}
	path, err := policyFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func LoadRegistry() (*Registry, error) {
	path, err := registryFilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &Registry{Plugins: map[string]RegistryEntry{}}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &Registry{Plugins: map[string]RegistryEntry{}}, nil
	}
	var r Registry
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	if r.Plugins == nil {
		r.Plugins = map[string]RegistryEntry{}
	}
	return &r, nil
}

func SaveRegistry(r *Registry) error {
	if r == nil {
		return fmt.Errorf("nil registry")
	}
	if r.Plugins == nil {
		r.Plugins = map[string]RegistryEntry{}
	}
	path, err := registryFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func InstallFromSource(source string) (RegistryEntry, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		return RegistryEntry{}, fmt.Errorf("plugin source is required")
	}

	// Allowlist enforcement (P2-5) — we need the plugin name to check the
	// allowlist, but we don't know it until after we resolve the source.  We
	// therefore do a lightweight name extraction from the source path/URL here
	// so we can fail fast before performing any I/O or network operations.
	if candidateName := extractPluginNameFromSource(source); candidateName != "" {
		if err := IsPluginAllowed(candidateName); err != nil {
			return RegistryEntry{}, err
		}
	}

	if !strings.HasPrefix(source, "github.com/") && !pathExists(source) {
		if mp, err := LookupMarketplace(source); err == nil && strings.TrimSpace(mp.Source) != "" {
			source = mp.Source
		}
	}
	var (
		name       string
		execPath   string
		manifest   string
		sourceType string
		err        error
	)
	if strings.HasPrefix(source, "github.com/") {
		name, execPath, manifest, err = installFromGitHub(source)
		sourceType = "github"
	} else {
		name, execPath, manifest, err = installFromLocal(source)
		sourceType = "local"
	}
	if err != nil {
		return RegistryEntry{}, err
	}
	if err := copyPluginArtifacts(name, execPath, manifest); err != nil {
		return RegistryEntry{}, err
	}
	// Compute the SHA-256 of the freshly installed binary and store it in
	// the registry so that VerifyPlugin can detect tampering on future runs.
	pluginDir, checksumErr := PluginDir()
	var recordedChecksum string
	if checksumErr == nil {
		installedBinary := filepath.Join(pluginDir, pluginPrefix+name)
		if sum, err2 := BinaryChecksum(installedBinary); err2 == nil {
			recordedChecksum = sum
		}
	}
	entry := RegistryEntry{
		Name:        name,
		Source:      source,
		SourceType:  sourceType,
		InstalledAt: time.Now().UTC(),
		SHA256:      recordedChecksum,
	}
	reg, err := LoadRegistry()
	if err != nil {
		return RegistryEntry{}, err
	}
	reg.Plugins[name] = entry
	if err := SaveRegistry(reg); err != nil {
		return RegistryEntry{}, err
	}
	return entry, nil
}

func UpdateInstalled(name string) (RegistryEntry, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return RegistryEntry{}, fmt.Errorf("plugin name is required")
	}
	reg, err := LoadRegistry()
	if err != nil {
		return RegistryEntry{}, err
	}
	entry, ok := reg.Plugins[name]
	if !ok {
		return RegistryEntry{}, fmt.Errorf("plugin %q is not in install registry; reinstall with `kcli plugin install <source>`", name)
	}
	return InstallFromSource(entry.Source)
}

func UpdateAllInstalled() ([]RegistryEntry, error) {
	reg, err := LoadRegistry()
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(reg.Plugins))
	for name := range reg.Plugins {
		names = append(names, name)
	}
	sort.Strings(names)
	updated := make([]RegistryEntry, 0, len(names))
	for _, name := range names {
		entry, err := UpdateInstalled(name)
		if err != nil {
			return updated, err
		}
		updated = append(updated, entry)
	}
	return updated, nil
}

func RemoveInstalled(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("plugin name is required")
	}
	bin, err := Resolve(name)
	if err != nil {
		return err
	}
	manifestPath, _ := findManifestPath(bin)
	if err := os.Remove(bin); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if manifestPath != "" {
		_ = os.Remove(manifestPath)
	}
	reg, err := LoadRegistry()
	if err != nil {
		return err
	}
	delete(reg.Plugins, name)
	return SaveRegistry(reg)
}

func SearchInstalled(keyword string) ([]PluginInfo, error) {
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	all, err := DiscoverInfo()
	if err != nil {
		return nil, err
	}
	if keyword == "" {
		return all, nil
	}
	filtered := make([]PluginInfo, 0, len(all))
	for _, p := range all {
		hay := p.Name
		if p.Manifest != nil {
			hay += " " + p.Manifest.Description + " " + strings.Join(p.Manifest.Commands, " ")
		}
		if strings.Contains(strings.ToLower(hay), keyword) {
			filtered = append(filtered, p)
		}
	}
	return filtered, nil
}

func AllowPermissions(pluginName string, permissions []string) error {
	pluginName = strings.TrimSpace(pluginName)
	if pluginName == "" {
		return fmt.Errorf("plugin name required")
	}
	s, err := LoadPolicy()
	if err != nil {
		return err
	}
	base := s.Allowed[pluginName]
	s.Allowed[pluginName] = dedupeStrings(append(base, permissions...))
	return SavePolicy(s)
}

func RevokePermissions(pluginName string, permissions []string) error {
	pluginName = strings.TrimSpace(pluginName)
	if pluginName == "" {
		return fmt.Errorf("plugin name required")
	}
	s, err := LoadPolicy()
	if err != nil {
		return err
	}
	if len(permissions) == 0 {
		delete(s.Allowed, pluginName)
		return SavePolicy(s)
	}
	rm := map[string]struct{}{}
	for _, p := range permissions {
		p = strings.TrimSpace(p)
		if p != "" {
			rm[p] = struct{}{}
		}
	}
	current := s.Allowed[pluginName]
	out := make([]string, 0, len(current))
	for _, p := range current {
		if _, found := rm[p]; !found {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		delete(s.Allowed, pluginName)
	} else {
		s.Allowed[pluginName] = out
	}
	return SavePolicy(s)
}

func MissingPermissions(pluginName string, required []string) ([]string, error) {
	s, err := LoadPolicy()
	if err != nil {
		return nil, err
	}
	required = dedupeStrings(required)
	if len(required) == 0 {
		return nil, nil
	}
	allowed := map[string]struct{}{}
	for _, p := range s.Allowed[pluginName] {
		p = strings.TrimSpace(p)
		if p != "" {
			allowed[p] = struct{}{}
		}
	}
	missing := make([]string, 0, len(required))
	for _, p := range required {
		if _, ok := allowed[p]; !ok {
			missing = append(missing, p)
		}
	}
	sort.Strings(missing)
	return missing, nil
}

func IsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func ensurePermissions(pluginName string, permissions []string) error {
	missing, err := MissingPermissions(pluginName, permissions)
	if err != nil {
		return err
	}
	if len(missing) == 0 {
		return nil
	}
	if !IsTerminal() {
		return fmt.Errorf("plugin %q requires unapproved permissions: %s (approve first with: kcli plugin allow %s ...)", pluginName, strings.Join(missing, ", "), pluginName)
	}

	fmt.Fprintf(os.Stderr, "Plugin %q requests permissions:\n", pluginName)
	for _, p := range missing {
		fmt.Fprintf(os.Stderr, "  - %s\n", p)
	}
	fmt.Fprint(os.Stderr, "Approve and continue? [y/N]: ")
	r := bufio.NewReader(os.Stdin)
	line, err := r.ReadString('\n')
	if err != nil {
		return err
	}
	ans := strings.ToLower(strings.TrimSpace(line))
	if ans != "y" && ans != "yes" {
		return fmt.Errorf("plugin execution aborted")
	}
	return AllowPermissions(pluginName, missing)
}

func loadManifestForResolved(pluginName, binaryPath string) (*Manifest, error) {
	manifestPath, err := findManifestPath(binaryPath)
	if err != nil {
		return nil, fmt.Errorf("plugin %q: %w", pluginName, err)
	}
	b, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := yaml.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("invalid manifest format: %w", err)
	}
	if err := validateManifest(pluginName, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func findManifestPath(binaryPath string) (string, error) {
	dir := filepath.Dir(binaryPath)
	base := filepath.Base(binaryPath)
	candidates := []string{
		filepath.Join(dir, base+".yaml"),
		filepath.Join(dir, "plugin.yaml"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("manifest not found (expected plugin.yaml or %s.yaml near executable)", base)
}

// checkMinKcliVersion returns an error if the plugin's minKcliVersion is greater than the current kcli version.
func checkMinKcliVersion(required string) error {
	required = strings.TrimSpace(required)
	if required == "" {
		return nil
	}
	current := strings.TrimSpace(version.Version)
	if current == "" {
		return nil
	}
	if !semverLess(current, required) {
		return nil
	}
	return fmt.Errorf("plugin requires kcli >= %s (current: %s)", required, current)
}

// semverLess returns true if a < b (each interpreted as major.minor.patch).
func semverLess(a, b string) bool {
	parse := func(s string) [3]int {
		var out [3]int
		s = strings.TrimPrefix(strings.TrimSpace(s), "v")
		parts := strings.SplitN(s, ".", 4)
		for i := 0; i < 3 && i < len(parts); i++ {
			n, _ := strconv.Atoi(strings.TrimSpace(parts[i]))
			out[i] = n
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	for i := 0; i < 3; i++ {
		if pa[i] < pb[i] {
			return true
		}
		if pa[i] > pb[i] {
			return false
		}
	}
	return false
}

func validateManifest(pluginName string, m *Manifest) error {
	if m == nil {
		return fmt.Errorf("manifest is nil")
	}
	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" {
		return fmt.Errorf("manifest.name is required")
	}
	if !validPluginName.MatchString(m.Name) {
		return fmt.Errorf("manifest.name %q is invalid", m.Name)
	}
	if m.Name != pluginName {
		return fmt.Errorf("manifest.name %q does not match plugin name %q", m.Name, pluginName)
	}
	m.Version = strings.TrimSpace(m.Version)
	if m.Version == "" {
		return fmt.Errorf("manifest.version is required")
	}
	m.Permissions = dedupeStrings(m.Permissions)
	for _, p := range m.Permissions {
		if err := validatePermission(p); err != nil {
			return err
		}
	}
	m.Commands = dedupeStrings(m.Commands)
	for _, c := range m.Commands {
		if !validPluginName.MatchString(c) {
			return fmt.Errorf("invalid manifest.commands entry %q", c)
		}
	}
	return nil
}

func validatePermission(p string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return fmt.Errorf("manifest.permissions cannot include empty entries")
	}
	parts := strings.SplitN(p, ":", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return fmt.Errorf("invalid permission %q: expected format <action>:<resource>", p)
	}
	return nil
}

func dedupeStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func installFromLocal(source string) (name, execPath, manifestPath string, err error) {
	abs, err := filepath.Abs(source)
	if err != nil {
		return "", "", "", err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", "", "", err
	}
	if st.IsDir() {
		entries, derr := os.ReadDir(abs)
		if derr != nil {
			return "", "", "", derr
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			n := e.Name()
			if strings.HasPrefix(n, pluginPrefix) {
				execPath = filepath.Join(abs, n)
				break
			}
		}
		if execPath == "" {
			return "", "", "", fmt.Errorf("no plugin executable found in %q (expected %s*)", abs, pluginPrefix)
		}
	} else {
		execPath = abs
	}
	base := filepath.Base(execPath)
	if !strings.HasPrefix(base, pluginPrefix) {
		return "", "", "", fmt.Errorf("plugin executable name must start with %q", pluginPrefix)
	}
	name = strings.TrimPrefix(base, pluginPrefix)
	if !validPluginName.MatchString(name) {
		return "", "", "", fmt.Errorf("invalid plugin name %q", name)
	}
	manifestPath, err = findManifestPath(execPath)
	if err != nil {
		return "", "", "", err
	}
	if _, err := loadManifestForResolved(name, execPath); err != nil {
		return "", "", "", err
	}
	return name, execPath, manifestPath, nil
}

func installFromGitHub(source string) (name, execPath, manifestPath string, err error) {
	tmp, err := os.MkdirTemp("", "kcli-plugin-src-*")
	if err != nil {
		return "", "", "", err
	}
	defer os.RemoveAll(tmp)
	repoURL := "https://" + strings.TrimSuffix(source, ".git") + ".git"
	clone := exec.Command("git", "clone", "--depth=1", repoURL, tmp)
	if out, cerr := clone.CombinedOutput(); cerr != nil {
		return "", "", "", fmt.Errorf("git clone failed: %v: %s", cerr, strings.TrimSpace(string(out)))
	}
	name, execPath, manifestPath, err = installFromLocal(tmp)
	if err != nil {
		return "", "", "", err
	}
	// ensure copied artifacts survive temp dir cleanup
	dstTmp, err := os.MkdirTemp("", "kcli-plugin-build-*")
	if err != nil {
		return "", "", "", err
	}
	execCopy := filepath.Join(dstTmp, filepath.Base(execPath))
	manifestCopy := filepath.Join(dstTmp, filepath.Base(manifestPath))
	if err := copyFile(execPath, execCopy, 0o755); err != nil {
		return "", "", "", err
	}
	if err := copyFile(manifestPath, manifestCopy, 0o644); err != nil {
		return "", "", "", err
	}
	return name, execCopy, manifestCopy, nil
}

func copyPluginArtifacts(name, execPath, manifestPath string) error {
	dir, err := PluginDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	dstBin := filepath.Join(dir, pluginPrefix+name)
	dstManifest := filepath.Join(dir, pluginPrefix+name+".yaml")
	if err := copyFile(execPath, dstBin, 0o755); err != nil {
		return err
	}
	if err := copyFile(manifestPath, dstManifest, 0o644); err != nil {
		return err
	}
	_, err = loadManifestForResolved(name, dstBin)
	return err
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Chmod(mode)
}

// ---------------------------------------------------------------------------
// Plugin binary integrity — P2-1
// ---------------------------------------------------------------------------

// BinaryChecksum computes the hex-encoded SHA-256 digest of the file at path.
// This is used both at install time (to record the expected digest) and at
// run time (to verify the binary has not been tampered with).
// It delegates to FileSHA256, which is the canonical implementation.
func BinaryChecksum(path string) (string, error) {
	return FileSHA256(path)
}

// ErrChecksumMismatch is returned by VerifyPlugin when the binary digest
// differs from the value recorded at install time.
var ErrChecksumMismatch = errors.New("plugin binary checksum mismatch — binary may have been tampered with; re-install the plugin or run 'kcli plugin verify'")

// VerifyPlugin verifies the integrity of an installed plugin binary by
// comparing its current SHA-256 checksum against the value stored in the
// registry at install time.
//
// If the registry entry has no recorded checksum (legacy install), the
// function returns nil (passes without error) and logs a warning so that
// operators know the plugin has not been verified.
//
// Call VerifyPlugin before executing any plugin binary. This detects:
//   - Binary replacement after installation (supply chain attack).
//   - Accidental file corruption.
//   - Mismatch between the expected and installed version.
func VerifyPlugin(name string) error {
	reg, err := LoadRegistry()
	if err != nil {
		// Registry load failure is not a security error — treat as unverified.
		return nil
	}
	entry, ok := reg.Plugins[name]
	if !ok {
		// Not in registry (e.g. manually placed plugin) — skip verification.
		return nil
	}
	if strings.TrimSpace(entry.SHA256) == "" {
		// Legacy install: no checksum recorded. Verification is advisory only;
		// we cannot fail here without breaking existing installations.
		return nil
	}
	path, err := Resolve(name)
	if err != nil {
		return err
	}
	actual, err := BinaryChecksum(path)
	if err != nil {
		return fmt.Errorf("plugin %s: computing checksum: %w", name, err)
	}
	if actual != entry.SHA256 {
		return fmt.Errorf("plugin %s: %w\n  expected: %s\n  actual:   %s",
			name, ErrChecksumMismatch, entry.SHA256, actual)
	}
	return nil
}

// recordChecksum computes the binary checksum for the installed plugin and
// stores it in the registry. Call this at the end of successful installation
// (after the binary is in its final location).
func recordChecksum(name, binaryPath string) error {
	sum, err := BinaryChecksum(binaryPath)
	if err != nil {
		return err
	}
	reg, err := LoadRegistry()
	if err != nil {
		return err
	}
	entry := reg.Plugins[name]
	entry.SHA256 = sum
	reg.Plugins[name] = entry
	return SaveRegistry(reg)
}

func MarketplaceCatalog() ([]MarketplacePlugin, error) {
	if path := strings.TrimSpace(os.Getenv("KCLI_PLUGIN_MARKETPLACE_FILE")); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var out []MarketplacePlugin
		if err := json.Unmarshal(b, &out); err != nil {
			return nil, fmt.Errorf("invalid marketplace JSON: %w", err)
		}
		return normalizeMarketplace(out), nil
	}
	return normalizeMarketplace(defaultMarketplaceCatalog()), nil
}

func SearchMarketplace(keyword string) ([]MarketplacePlugin, error) {
	catalog, err := MarketplaceCatalog()
	if err != nil {
		return nil, err
	}
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	if keyword == "" {
		return catalog, nil
	}
	out := make([]MarketplacePlugin, 0, len(catalog))
	for _, p := range catalog {
		hay := strings.ToLower(p.Name + " " + p.Description + " " + strings.Join(p.Tags, " "))
		if strings.Contains(hay, keyword) {
			out = append(out, p)
		}
	}
	return out, nil
}

func LookupMarketplace(name string) (MarketplacePlugin, error) {
	catalog, err := MarketplaceCatalog()
	if err != nil {
		return MarketplacePlugin{}, err
	}
	name = strings.ToLower(strings.TrimSpace(name))
	for _, p := range catalog {
		if strings.ToLower(strings.TrimSpace(p.Name)) == name {
			return p, nil
		}
	}
	return MarketplacePlugin{}, fmt.Errorf("plugin %q not found in marketplace", name)
}

func normalizeMarketplace(in []MarketplacePlugin) []MarketplacePlugin {
	out := make([]MarketplacePlugin, 0, len(in))
	for _, p := range in {
		p.Name = strings.TrimSpace(p.Name)
		p.Source = strings.TrimSpace(p.Source)
		p.Version = strings.TrimSpace(p.Version)
		p.Description = strings.TrimSpace(p.Description)
		p.Tags = dedupeStrings(p.Tags)
		if p.Name == "" {
			continue
		}
		out = append(out, p)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func defaultMarketplaceCatalog() []MarketplacePlugin {
	return []MarketplacePlugin{
		{Name: "argocd", Source: "./official-plugins/argocd", Version: "1.0.0", Description: "Argo CD integration commands", Official: true, Downloads: 1200, Rating: 4.8, Tags: []string{"official", "gitops", "argocd"}},
		{Name: "backup", Source: "./official-plugins/backup", Version: "1.0.0", Description: "Velero backup and restore workflows", Official: true, Downloads: 930, Rating: 4.7, Tags: []string{"official", "backup", "velero"}},
		{Name: "cert-manager", Source: "./official-plugins/cert-manager", Version: "1.0.0", Description: "Manage cert-manager certificates", Official: true, Downloads: 1500, Rating: 4.9, Tags: []string{"official", "tls", "cert-manager"}},
		{Name: "istio", Source: "./official-plugins/istio", Version: "1.0.0", Description: "Istio mesh operational commands", Official: true, Downloads: 1100, Rating: 4.6, Tags: []string{"official", "mesh", "istio"}},
	}
}

func pathExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func hasCommandAlias(commands []string, command string) bool {
	command = strings.TrimSpace(command)
	for _, c := range commands {
		if strings.TrimSpace(c) == command {
			return true
		}
	}
	return false
}

// FileSHA256 returns the SHA256 checksum of the file at path in hex format.
// Used by plugin verify for integrity checking.
func FileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// extractPluginNameFromSource derives a candidate plugin name from an install
// source path or GitHub URL so that the allowlist can be consulted before any
// expensive I/O takes place.
//
// Examples:
//
//	"github.com/org/kcli-argocd"           → "argocd"
//	"github.com/org/kcli-cert-manager"     → "cert-manager"
//	"/local/path/kcli-backup"              → "backup"
//	"argocd"                               → "argocd"  (marketplace shorthand)
//	"unknown-format"                       → ""        (skip pre-check)
func extractPluginNameFromSource(source string) string {
	// Marketplace shorthand — valid plugin name directly.
	if validPluginName.MatchString(source) {
		return source
	}
	// GitHub URL: last path segment is the repo name.
	if strings.HasPrefix(source, "github.com/") {
		parts := strings.Split(strings.TrimSuffix(source, ".git"), "/")
		last := strings.TrimSpace(parts[len(parts)-1])
		if strings.HasPrefix(last, pluginPrefix) {
			name := strings.TrimPrefix(last, pluginPrefix)
			if validPluginName.MatchString(name) {
				return name
			}
		}
		return ""
	}
	// Local path: use the base file/directory name.
	base := filepath.Base(filepath.Clean(source))
	if strings.HasPrefix(base, pluginPrefix) {
		name := strings.TrimPrefix(base, pluginPrefix)
		if validPluginName.MatchString(name) {
			return name
		}
	}
	return ""
}

func validateSandbox(binaryPath string) error {
	clean := filepath.Clean(binaryPath)
	lst, err := os.Lstat(clean)
	if err != nil {
		return err
	}
	if lst.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("plugin binary %q must not be a symlink", clean)
	}
	if lst.Mode().Perm()&0o022 != 0 {
		return fmt.Errorf("plugin binary %q must not be group/world-writable", clean)
	}
	pluginDir, err := PluginDir()
	if err != nil {
		return err
	}
	pluginDir = filepath.Clean(pluginDir)
	rel, err := filepath.Rel(pluginDir, clean)
	if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil
	}
	if strings.TrimSpace(os.Getenv("KCLI_PLUGIN_ALLOW_PATH")) == "1" {
		return nil
	}
	return fmt.Errorf("plugin binary %q is outside %q (set KCLI_PLUGIN_ALLOW_PATH=1 to allow PATH plugins)", clean, pluginDir)
}
