package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func TestPromptCommandExistsAndHelpText(t *testing.T) {
	root := NewRootCommand()
	var promptCmd *cobra.Command
	for _, c := range root.Commands() {
		if c.Name() == "prompt" {
			promptCmd = c
			break
		}
	}
	if promptCmd == nil {
		t.Fatal("root command missing 'prompt' subcommand")
	}
	if !strings.Contains(strings.ToLower(promptCmd.Short), "shell") || !strings.Contains(strings.ToLower(promptCmd.Short), "ps1") {
		t.Logf("Short: %s", promptCmd.Short)
	}
	if !strings.Contains(promptCmd.Long, "eval") || !strings.Contains(promptCmd.Long, "PS1") {
		t.Fatalf("Long help should mention eval and PS1: %s", promptCmd.Long)
	}
}

func TestPromptCommandOutputContainsPS1(t *testing.T) {
	// Minimal kubeconfig so CurrentContextAndNamespace returns a value without a real cluster.
	dir := t.TempDir()
	kubeconfig := filepath.Join(dir, "kubeconfig")
	const minimalKubeconfig = `apiVersion: v1
kind: Config
current-context: test-ctx
contexts:
- name: test-ctx
  context: { cluster: c, user: u }
clusters:
- name: c
  cluster: { server: https://example.com }
users:
- name: u
  user: {}
`
	if err := os.WriteFile(kubeconfig, []byte(minimalKubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}
	a := &app{kubeconfig: kubeconfig}
	cmd := newPromptCmd(a)
	cmd.SetArgs(nil)
	var out strings.Builder
	cmd.SetOut(&out)
	if err := cmd.Execute(); err != nil {
		t.Fatalf("prompt execute: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "export PS1=") {
		t.Fatalf("output should contain export PS1=: %q", got)
	}
	if !strings.Contains(got, "test-ctx") {
		t.Fatalf("output should contain current context test-ctx: %q", got)
	}
}
