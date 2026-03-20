package rest

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func TestCompletionWords_TrailingWhitespaceAddsEmptyToken(t *testing.T) {
	tests := []struct {
		name string
		line string
		want []string
	}{
		{
			name: "no trailing space",
			line: "kubectl get po",
			want: []string{"kubectl", "get", "po"},
		},
		{
			name: "trailing space",
			line: "kubectl get po ",
			want: []string{"kubectl", "get", "po", ""},
		},
		{
			name: "multiple spaces trailing",
			line: "kubectl config use-context   ",
			want: []string{"kubectl", "config", "use-context", ""},
		},
		{
			name: "empty line",
			line: "",
			want: nil,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := completionWords(tc.line)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("completionWords(%q) = %#v, want %#v", tc.line, got, tc.want)
			}
		})
	}
}

func TestFileFlagCompletions(t *testing.T) {
	tmpDir := t.TempDir()
	manifest := filepath.Join(tmpDir, "manifest.yaml")
	if err := os.WriteFile(manifest, []byte("apiVersion: v1\nkind: Pod\n"), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	kustomizeDir := filepath.Join(tmpDir, "kustomize")
	if err := os.MkdirAll(kustomizeDir, 0o755); err != nil {
		t.Fatalf("mkdir kustomize: %v", err)
	}

	t.Run("separate -f value", func(t *testing.T) {
		got := fileFlagCompletions([]string{"kubectl", "apply", "-f", filepath.Join(tmpDir, "man")})
		want := []string{manifest}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("fileFlagCompletions(-f) = %#v, want %#v", got, want)
		}
	})

	t.Run("inline -f value", func(t *testing.T) {
		got := fileFlagCompletions([]string{"kubectl", "apply", "-f" + filepath.Join(tmpDir, "man")})
		want := []string{"-f" + manifest}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("fileFlagCompletions(inline -f) = %#v, want %#v", got, want)
		}
	})

	t.Run("--kustomize directory", func(t *testing.T) {
		got := fileFlagCompletions([]string{"kcli", "apply", "--kustomize", filepath.Join(tmpDir, "kus")})
		want := []string{kustomizeDir + "/"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("fileFlagCompletions(--kustomize) = %#v, want %#v", got, want)
		}
	})

	t.Run("irrelevant verb returns nil", func(t *testing.T) {
		got := fileFlagCompletions([]string{"kubectl", "get", "pods"})
		if got != nil {
			t.Fatalf("fileFlagCompletions(get pods) = %#v, want nil", got)
		}
	})

	t.Run("results are sorted and capped", func(t *testing.T) {
		bigDir := filepath.Join(tmpDir, "big")
		if err := os.MkdirAll(bigDir, 0o755); err != nil {
			t.Fatalf("mkdir big dir: %v", err)
		}
		total := fileCompletionMaxResults + 25
		for i := 0; i < total; i++ {
			name := fmt.Sprintf("file-%03d.yaml", i)
			if err := os.WriteFile(filepath.Join(bigDir, name), []byte("x"), 0o600); err != nil {
				t.Fatalf("write %s: %v", name, err)
			}
		}

		got := fileFlagCompletions([]string{"kubectl", "apply", "-f", bigDir + "/"})
		if len(got) != fileCompletionMaxResults {
			t.Fatalf("len(fileFlagCompletions) = %d, want %d", len(got), fileCompletionMaxResults)
		}
		sorted := append([]string(nil), got...)
		sort.Strings(sorted)
		if !reflect.DeepEqual(got, sorted) {
			t.Fatalf("fileFlagCompletions should be sorted")
		}
	})
}
