package rest

import (
	"fmt"
	"slices"
	"strings"
	"sync"

	"golang.org/x/time/rate"
)

const (
	defaultKCLIRateLimitPerSec = 12.0
	defaultKCLIRateLimitBurst  = 24
	defaultKCLIStreamMaxConns  = 4
	maxKCLIArgs                = 64
	maxKCLIArgLen              = 512
)

var (
	allowedKCLIVerbs = []string{
		"get", "describe", "apply", "delete", "logs", "exec", "port-forward", "top", "rollout", "diff", "explain", "wait", "scale", "patch", "label", "annotate",
		"auth", "ctx", "ns", "search", "metrics", "restarts", "instability", "events", "incident", "ai", "why", "summarize", "suggest", "completion", "plugin",
	}
	mutatingKCLIVerbs = map[string]struct{}{
		"apply": {}, "delete": {}, "patch": {}, "scale": {}, "label": {}, "annotate": {}, "rollout": {},
	}
	blockedKCLIFlags = []string{
		"--kubeconfig",
		"--context",
		"--all-contexts",
		"--context-group",
	}
)

func sanitizeKCLIArgs(args []string) []string {
	out := make([]string, 0, len(args))
	for _, a := range args {
		a = strings.TrimSpace(a)
		if a != "" {
			out = append(out, a)
		}
	}
	for len(out) > 0 && strings.EqualFold(out[0], "kcli") {
		out = out[1:]
	}
	return out
}

func validateKCLIArgs(args []string, force bool) ([]string, bool, error) {
	args = sanitizeKCLIArgs(args)
	if len(args) == 0 {
		return nil, false, fmt.Errorf("kcli args are required")
	}
	if len(args) > maxKCLIArgs {
		return nil, false, fmt.Errorf("too many arguments (max %d)", maxKCLIArgs)
	}
	for _, a := range args {
		if len(a) > maxKCLIArgLen {
			return nil, false, fmt.Errorf("argument too long (max %d chars): %q", maxKCLIArgLen, a[:64])
		}
		for _, blocked := range blockedKCLIFlags {
			if a == blocked || strings.HasPrefix(a, blocked+"=") {
				return nil, false, fmt.Errorf("flag %q is not allowed in embedded kcli mode", blocked)
			}
		}
	}

	verb := strings.ToLower(strings.TrimSpace(args[0]))
	if !slices.Contains(allowedKCLIVerbs, verb) {
		return nil, false, fmt.Errorf("command %q is not allowed in embedded kcli mode", verb)
	}
	// UI mode requires interactive PTY, so it's not supported in non-interactive exec endpoint
	if verb == "ui" {
		return nil, false, fmt.Errorf("command %q requires interactive PTY; use /kcli/stream?mode=ui instead", verb)
	}
	// Plugin commands are allowed in exec endpoint (plugins can be executed non-interactively)
	// Note: Plugin execution via PTY stream also works for interactive plugins
	_, mutating := mutatingKCLIVerbs[verb]
	if mutating && !force {
		return nil, true, fmt.Errorf("mutating command %q requires force=true", verb)
	}
	return args, mutating, nil
}

func renderAuditCommand(args []string) string {
	const maxChars = 256
	if len(args) == 0 {
		return ""
	}
	cmd := strings.Join(args, " ")
	if len(cmd) > maxChars {
		return cmd[:maxChars] + "...(truncated)"
	}
	return cmd
}

func (h *Handler) allowKCLIRate(clusterID, channel string) bool {
	if strings.TrimSpace(clusterID) == "" {
		return true
	}
	ratePerSec := defaultKCLIRateLimitPerSec
	burst := defaultKCLIRateLimitBurst
	if h.cfg != nil {
		if h.cfg.KCLIRateLimitPerSec > 0 {
			ratePerSec = h.cfg.KCLIRateLimitPerSec
		}
		if h.cfg.KCLIRateLimitBurst > 0 {
			burst = h.cfg.KCLIRateLimitBurst
		}
	}
	if ratePerSec <= 0 || burst <= 0 {
		return true
	}
	key := clusterID + ":" + strings.TrimSpace(channel)

	h.kcliLimiterMu.Lock()
	limiter, ok := h.kcliLimiters[key]
	if !ok {
		limiter = rate.NewLimiter(rate.Limit(ratePerSec), burst)
		h.kcliLimiters[key] = limiter
	}
	h.kcliLimiterMu.Unlock()

	return limiter.Allow()
}

func (h *Handler) acquireKCLIStreamSlot(clusterID string) (func(), bool) {
	if strings.TrimSpace(clusterID) == "" {
		return func() {}, true
	}
	maxConns := defaultKCLIStreamMaxConns
	if h.cfg != nil && h.cfg.KCLIStreamMaxConns > 0 {
		maxConns = h.cfg.KCLIStreamMaxConns
	}
	if maxConns <= 0 {
		return func() {}, true
	}

	h.kcliStreamMu.Lock()
	defer h.kcliStreamMu.Unlock()
	if h.kcliStreamActive[clusterID] >= maxConns {
		return func() {}, false
	}
	h.kcliStreamActive[clusterID]++

	var once sync.Once
	release := func() {
		once.Do(func() {
			h.kcliStreamMu.Lock()
			defer h.kcliStreamMu.Unlock()
			if h.kcliStreamActive[clusterID] <= 1 {
				delete(h.kcliStreamActive, clusterID)
				return
			}
			h.kcliStreamActive[clusterID]--
		})
	}
	return release, true
}

func (h *Handler) isKCLIShellModeAllowed() bool {
	if h.cfg == nil {
		return true
	}
	return h.cfg.KCLIAllowShellMode
}
