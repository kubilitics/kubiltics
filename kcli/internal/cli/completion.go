package cli

import (
	"fmt"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

type cacheEntry struct {
	value   string
	expires time.Time
}

func (a *app) completeKubectl(verb string) func(*cobra.Command, []string, string) ([]string, cobra.ShellCompDirective) {
	return func(_ *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
		if awaiting, ok := awaitingFlagValue(args, verb); ok {
			return a.completeFlagValue(awaiting, toComplete), cobra.ShellCompDirectiveNoFileComp
		}
		if strings.HasPrefix(toComplete, "-") {
			return filterPrefix(knownFlagsForVerb(verb), toComplete), cobra.ShellCompDirectiveNoFileComp
		}

		resIdx := resourceArgIndex(args)
		if resIdx < 0 {
			items, err := a.resourceTypes()
			if err != nil {
				return nil, cobra.ShellCompDirectiveNoFileComp
			}
			return filterPrefix(items, toComplete), cobra.ShellCompDirectiveNoFileComp
		}

		if resIdx >= len(args) {
			types, err := a.resourceTypes()
			if err != nil {
				return nil, cobra.ShellCompDirectiveNoFileComp
			}
			return filterPrefix(types, toComplete), cobra.ShellCompDirectiveNoFileComp
		}

		res := strings.TrimSpace(args[resIdx])
		if res == "" || strings.HasPrefix(res, "-") {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}

		names, err := a.resourceNames(verb, res, args)
		if err != nil {
			// P2-8: Cache miss or timeout — return empty completion (no error).
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return filterPrefix(names, toComplete), cobra.ShellCompDirectiveNoFileComp
	}
}

func filterPrefix(values []string, prefix string) []string {
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	if prefix == "" {
		return values
	}
	out := make([]string, 0, len(values))
	for _, v := range values {
		if strings.HasPrefix(strings.ToLower(v), prefix) {
			out = append(out, v)
		}
	}
	return out
}

// completionCacheTTL is the TTL for completion cache (P2-8: 2s for fast, cache-first completion).
const completionCacheTTL = 2 * time.Second

func (a *app) resourceTypes() ([]string, error) {
	key := fmt.Sprintf("api-resources:%s", strings.TrimSpace(a.context))
	out, err := a.cachedKubectl(key, []string{"api-resources", "-o", "name"}, completionCacheTTL)
	if err != nil {
		return nil, err
	}
	return splitNonEmptyLines(out), nil
}

// listVerbForCompletion returns "get" for verbs that need to list resources by name.
// exec, logs, port-forward, delete don't support listing; we use kubectl get -o name.
func listVerbForCompletion(verb string) string {
	switch verb {
	case "exec", "logs", "port-forward", "delete":
		return "get"
	default:
		return verb
	}
}

func (a *app) resourceNames(verb, resource string, inputArgs []string) ([]string, error) {
	listVerb := listVerbForCompletion(verb)
	args := []string{listVerb, resource}
	args = append(args, extractScopeFlags(inputArgs)...)
	args = append(args, "-o", "name")
	key := fmt.Sprintf("names:%s:%s:%s:%s:%s", listVerb, resource, a.namespace, a.context, strings.Join(extractScopeFlags(inputArgs), "|"))
	out, err := a.cachedKubectl(key, args, completionCacheTTL)
	if err != nil {
		return nil, err
	}
	return splitNonEmptyLines(out), nil
}

func splitNonEmptyLines(s string) []string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" {
			out = append(out, l)
		}
	}
	return out
}

// cachedKubectl returns cached output or fetches via kubectl. On cache miss or timeout,
// returns ("", err) so callers can fall back to empty completion (P2-8: no live API block).
func (a *app) cachedKubectl(key string, args []string, ttl time.Duration) (string, error) {
	now := time.Now()
	a.cacheMu.Lock()
	if ent, ok := a.cache[key]; ok && now.Before(ent.expires) {
		value := ent.value
		a.cacheMu.Unlock()
		return value, nil
	}
	stale, hasStale := a.cache[key]
	a.cacheMu.Unlock()

	out, err := a.captureKubectlWithTimeout(args, a.completionTimeout)
	if err != nil {
		if hasStale {
			return stale.value, nil
		}
		// P2-8: Fall back to empty on cache miss/timeout — no error to user.
		return "", err
	}
	a.cacheMu.Lock()
	a.cache[key] = cacheEntry{value: out, expires: now.Add(ttl)}
	a.cacheMu.Unlock()
	return out, nil
}

func initCache() map[string]cacheEntry {
	return map[string]cacheEntry{}
}

func resourceArgIndex(args []string) int {
	for i := 0; i < len(args); i++ {
		t := strings.TrimSpace(args[i])
		if t == "" {
			continue
		}
		if flagTakesValue(t) {
			i++
			continue
		}
		if strings.HasPrefix(t, "-") {
			continue
		}
		return i
	}
	return -1
}

func flagTakesValue(flag string) bool {
	switch flag {
	case "-n", "--namespace", "--context", "--context-group":
		return true
	default:
		return false
	}
}

func awaitingFlagValue(args []string, verb string) (string, bool) {
	if len(args) == 0 {
		return "", false
	}
	last := strings.TrimSpace(args[len(args)-1])
	if flagTakesValue(last) {
		return normalizeFlag(last), true
	}
	if strings.HasPrefix(last, "--") && strings.HasSuffix(last, "=") {
		return normalizeFlag(strings.TrimSuffix(last, "=")), true
	}
	return "", false
}

func normalizeFlag(flag string) string {
	if flag == "-n" {
		return "--namespace"
	}
	return flag
}

func knownFlagsForVerb(verb string) []string {
	flags := []string{
		"-n", "--namespace", "-A", "--all-namespaces",
		"--context", "--context-group",
	}
	if verb == "get" {
		flags = append(flags, "--all-contexts")
	}
	return flags
}

func extractScopeFlags(args []string) []string {
	out := make([]string, 0, 6)
	for i := 0; i < len(args); i++ {
		t := strings.TrimSpace(args[i])
		switch {
		case t == "-A" || t == "--all-namespaces":
			out = append(out, t)
		case t == "-n" || t == "--namespace" || t == "--context":
			if i+1 < len(args) {
				out = append(out, t, strings.TrimSpace(args[i+1]))
				i++
			}
		case strings.HasPrefix(t, "--namespace=") || strings.HasPrefix(t, "--context="):
			out = append(out, t)
		}
	}
	return out
}

func (a *app) completeFlagValue(flag, toComplete string) []string {
	switch flag {
	case "--context":
		ctxs, err := listContexts(a)
		if err != nil {
			return nil
		}
		return filterPrefix(ctxs, toComplete)
	case "--namespace":
		out, err := a.cachedKubectl("namespaces:"+a.context, []string{"get", "namespaces", "-o", "name"}, 15*time.Second)
		if err != nil {
			return nil
		}
		names := splitNonEmptyLines(out)
		for i := range names {
			names[i] = strings.TrimPrefix(names[i], "namespace/")
		}
		return filterPrefix(names, toComplete)
	case "--context-group":
		s, err := state.Load()
		if err != nil || s.ContextGroups == nil {
			return nil
		}
		names := make([]string, 0, len(s.ContextGroups))
		for k := range s.ContextGroups {
			names = append(names, k)
		}
		return filterPrefix(names, toComplete)
	default:
		return nil
	}
}
