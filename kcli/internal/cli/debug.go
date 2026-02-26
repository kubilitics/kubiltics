package cli

// ---------------------------------------------------------------------------
// P3-4: First-Class debug Command (Ephemeral Containers)
//
// Wraps 'kubectl debug' with:
//   - Interactive image picker when --image is not specified (TTY only)
//   - Opinionated documented defaults for common debug scenarios
//   - --quick flag: immediately launch with nicolaka/netshoot (no picker)
//   - Clear UX for ephemeral container, pod-copy, and node debug modes
//
// All kubectl debug flags pass through unchanged.
//
// debug images built into the picker:
//   nicolaka/netshoot  — network debugging (tcpdump, curl, dig, ss, netstat)
//   busybox:latest     — minimal shell (cat, ls, nc, wget, nslookup)
//   ubuntu:22.04       — full Linux shell (apt, bash, python3, strace)
//   alpine:latest      — lightweight shell (ash, apk)
//   curlimages/curl    — pure curl for HTTP troubleshooting
// ---------------------------------------------------------------------------

import (
	"bufio"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// debugImages is the ordered list shown in the interactive picker.
// The first entry is the default (selected when user presses Enter).
var debugImages = []struct {
	Image       string
	Description string
}{
	{"nicolaka/netshoot", "network tools (tcpdump, curl, dig, ss, netstat, iperf3)"},
	{"busybox:latest", "minimal shell (cat, ls, nc, wget, nslookup)"},
	{"ubuntu:22.04", "full Linux shell (apt, bash, python3, strace, gdb)"},
	{"alpine:latest", "lightweight shell (ash, apk, openssl, wget)"},
	{"curlimages/curl:latest", "pure curl — HTTP/API troubleshooting"},
}

// newDebugCmd returns a first-class 'debug' command wrapping 'kubectl debug'
// with an interactive image picker and clear scenario documentation.
func newDebugCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "debug (POD|TYPE/NAME) [flags] [-- COMMAND [args...]]",
		Short: "Debug a pod or node with an ephemeral or copied container",
		Long: `Launch a debug session for a running pod or node.

Wraps 'kubectl debug' and adds an interactive debug-image picker when
--image is not specified (on TTY).  All kubectl debug flags are forwarded
unchanged.

Debug modes:

  Ephemeral container (recommended, non-disruptive):
    kcli debug pod/my-pod -it

  Copy pod for non-disruptive debug (pod keeps running):
    kcli debug pod/my-pod --copy-to=debug-pod -it

  Node debugging (privileged, use with caution):
    kcli debug node/my-node -it

Debug image quick-picks:

  --quick          Use nicolaka/netshoot immediately (best for network issues)
  --image=<IMAGE>  Specify any image directly (skips picker)

Common scenarios:

  # Network debugging (DNS, connectivity, latency)
  kcli debug pod/my-pod --quick

  # App debugging with same base image
  kcli debug pod/my-pod --image=$(kcli get pod my-pod -o jsonpath='{.spec.containers[0].image}')

  # Non-disruptive copy for sensitive workloads
  kcli debug pod/my-pod --copy-to=my-pod-debug --image=ubuntu:22.04 -it`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags.
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Separate our own flags from kubectl debug flags.
			quick, kArgs := parseDebugFlags(clean)

			// Check if --image is already set by the user.
			hasImage := hasDebugImage(kArgs)

			// --quick: use netshoot immediately without picker.
			if quick && !hasImage {
				kArgs = append([]string{"--image=" + debugImages[0].Image}, kArgs...)
				hasImage = true
			}

			// TTY + no image: show interactive picker.
			if !hasImage && isColorOutput(a.stderr) {
				chosen, err := pickDebugImage(a)
				if err != nil {
					return err
				}
				kArgs = append([]string{"--image=" + chosen}, kArgs...)
			}

			return a.runKubectl(append([]string{"debug"}, kArgs...))
		},
	}
}

// ---------------------------------------------------------------------------
// parseDebugFlags strips --quick from args, forwarding the rest to kubectl.
// ---------------------------------------------------------------------------

func parseDebugFlags(args []string) (quick bool, rest []string) {
	rest = make([]string, 0, len(args))
	for _, a := range args {
		if strings.TrimSpace(a) == "--quick" {
			quick = true
		} else {
			rest = append(rest, a)
		}
	}
	return
}

// hasDebugImage reports whether --image or --image=<x> appears in args.
func hasDebugImage(args []string) bool {
	for i, a := range args {
		t := strings.TrimSpace(a)
		if t == "--image" && i+1 < len(args) {
			return true
		}
		if strings.HasPrefix(t, "--image=") {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// pickDebugImage shows an interactive numbered menu and returns the chosen
// image name.  Defaults to debugImages[0] when the user presses Enter.
// ---------------------------------------------------------------------------

func pickDebugImage(a *app) (string, error) {
	fmt.Fprintln(a.stderr, "Select a debug image:")
	for i, img := range debugImages {
		fmt.Fprintf(a.stderr, "  [%d] %-32s %s\n", i+1, img.Image, img.Description)
	}
	fmt.Fprintf(a.stderr, "  [%d] Enter a custom image name\n", len(debugImages)+1)
	fmt.Fprintf(a.stderr, "Selection [1]: ")

	scanner := bufio.NewScanner(a.stdin)
	if !scanner.Scan() {
		// EOF or read error — fall back to default.
		fmt.Fprintln(a.stderr)
		return debugImages[0].Image, nil
	}
	input := strings.TrimSpace(scanner.Text())

	// Empty input → default.
	if input == "" {
		return debugImages[0].Image, nil
	}

	// Numeric selection.
	for i, img := range debugImages {
		if input == fmt.Sprintf("%d", i+1) {
			return img.Image, nil
		}
	}

	// Custom image entry.
	customSlot := fmt.Sprintf("%d", len(debugImages)+1)
	if input == customSlot {
		fmt.Fprint(a.stderr, "Custom image: ")
		if !scanner.Scan() {
			return "", fmt.Errorf("no image provided")
		}
		custom := strings.TrimSpace(scanner.Text())
		if custom == "" {
			return "", fmt.Errorf("custom image name cannot be empty")
		}
		return custom, nil
	}

	// Non-numeric input treated as a raw image name.
	if strings.ContainsAny(input, "/:") || strings.ContainsRune(input, '.') {
		return input, nil
	}

	return "", fmt.Errorf("invalid selection %q — enter a number 1-%d or an image name", input, len(debugImages)+1)
}
