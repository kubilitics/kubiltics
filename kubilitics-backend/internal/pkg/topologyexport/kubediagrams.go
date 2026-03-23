package topologyexport

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// KubeDiagramsBinaryName is the name of the KubeDiagrams CLI binary.
const KubeDiagramsBinaryName = "kube-diagrams"

// GraphToArchitecturePNG generates a professional architecture diagram using
// KubeDiagrams (Python + Graphviz). It runs kubectl to get resources as YAML,
// pipes them to kube-diagrams, and returns the rendered PNG bytes.
//
// Prerequisites: kube-diagrams and graphviz must be installed.
// Install: pip install KubeDiagrams && brew install graphviz (macOS)
//
// Returns ErrKubeDiagramsNotInstalled if kube-diagrams is not on PATH.
func GraphToArchitecturePNG(ctx context.Context, kubeconfigPath, namespace, kubectlPath string) ([]byte, error) {
	// Resolve kube-diagrams binary
	kubeDiagramsPath, err := resolveKubeDiagrams()
	if err != nil {
		return nil, err
	}

	// Resolve kubectl binary
	if kubectlPath == "" {
		kubectlPath = "kubectl"
	}

	// Build namespace flag
	nsFlag := "-n"
	nsValue := namespace
	if namespace == "" || namespace == "all" {
		nsFlag = "-A"
		nsValue = ""
	}

	// Generate unique output path
	outputPath := filepath.Join(os.TempDir(), fmt.Sprintf("kubilitics-arch-%s.png", uuid.New().String()))
	defer os.Remove(outputPath)

	// Build kubectl command: kubectl get all -n {namespace} -o yaml
	kubectlArgs := []string{"get", "all"}
	if nsFlag == "-A" {
		kubectlArgs = append(kubectlArgs, "-A")
	} else {
		kubectlArgs = append(kubectlArgs, nsFlag, nsValue)
	}
	kubectlArgs = append(kubectlArgs, "-o", "yaml")
	if kubeconfigPath != "" {
		kubectlArgs = append(kubectlArgs, "--kubeconfig", kubeconfigPath)
	}

	// Run kubectl | kube-diagrams pipeline using shell
	kubectlCmd := fmt.Sprintf("%s %s", kubectlPath, strings.Join(kubectlArgs, " "))
	kubeDiagramsCmd := fmt.Sprintf("%s -o %s -", kubeDiagramsPath, outputPath)
	pipeline := fmt.Sprintf("%s | %s", kubectlCmd, kubeDiagramsCmd)

	cmd := exec.CommandContext(ctx, "sh", "-c", pipeline)
	cmd.Env = buildEnv(kubeconfigPath)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("kube-diagrams failed: %w — stderr: %s", err, stderr.String())
	}

	// Read the generated PNG
	data, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read generated diagram: %w", err)
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("kube-diagrams produced empty output")
	}

	return data, nil
}

// IsKubeDiagramsAvailable checks if kube-diagrams is installed and accessible.
func IsKubeDiagramsAvailable() bool {
	_, err := resolveKubeDiagrams()
	return err == nil
}

// resolveKubeDiagrams finds the kube-diagrams binary on PATH or common locations.
func resolveKubeDiagrams() (string, error) {
	// Try PATH first
	if path, err := exec.LookPath(KubeDiagramsBinaryName); err == nil {
		return path, nil
	}

	// Common Python user-install locations
	home, _ := os.UserHomeDir()
	commonPaths := []string{
		filepath.Join(home, "Library", "Python", "3.9", "bin", KubeDiagramsBinaryName),
		filepath.Join(home, "Library", "Python", "3.10", "bin", KubeDiagramsBinaryName),
		filepath.Join(home, "Library", "Python", "3.11", "bin", KubeDiagramsBinaryName),
		filepath.Join(home, "Library", "Python", "3.12", "bin", KubeDiagramsBinaryName),
		filepath.Join(home, "Library", "Python", "3.13", "bin", KubeDiagramsBinaryName),
		filepath.Join(home, ".local", "bin", KubeDiagramsBinaryName),
		"/usr/local/bin/" + KubeDiagramsBinaryName,
		"/opt/homebrew/bin/" + KubeDiagramsBinaryName,
	}

	for _, p := range commonPaths {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}

	return "", fmt.Errorf("kube-diagrams not found — install with: pip install KubeDiagrams && brew install graphviz")
}

// buildEnv creates an environment for the subprocess, preserving PATH and
// adding common Python binary locations.
func buildEnv(kubeconfigPath string) []string {
	env := os.Environ()

	// Ensure Python user-install bin dirs are on PATH
	home, _ := os.UserHomeDir()
	extraPaths := []string{
		filepath.Join(home, "Library", "Python", "3.9", "bin"),
		filepath.Join(home, "Library", "Python", "3.10", "bin"),
		filepath.Join(home, "Library", "Python", "3.11", "bin"),
		filepath.Join(home, "Library", "Python", "3.12", "bin"),
		filepath.Join(home, "Library", "Python", "3.13", "bin"),
		filepath.Join(home, ".local", "bin"),
		"/opt/homebrew/bin",
	}

	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = e + ":" + strings.Join(extraPaths, ":")
			break
		}
	}

	if kubeconfigPath != "" {
		env = append(env, "KUBECONFIG="+kubeconfigPath)
	}

	return env
}
