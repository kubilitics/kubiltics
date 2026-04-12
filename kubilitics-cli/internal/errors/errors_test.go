package errors

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/runner"
)

func TestWrap_KubectlNotFound(t *testing.T) {
	err := Wrap(fmt.Errorf("kubectl not available: exec: \"kubectl\": executable file not found in $PATH"))
	ke, ok := err.(*KcliError)
	if !ok {
		t.Fatalf("expected *KcliError, got %T", err)
	}
	if ke.ErrCode != ErrKubectlNotFound {
		t.Fatalf("expected code %s, got %s", ErrKubectlNotFound, ke.ErrCode)
	}
	if !strings.Contains(ke.Hint, "Install kubectl") {
		t.Fatalf("expected install hint, got: %s", ke.Hint)
	}
}

func TestWrap_ResourceTypeNotFound(t *testing.T) {
	err := Wrap(&runner.KubectlError{
		Args:     []string{"get", "deploymnt"},
		ExitCode: 1,
		Stderr:   `error: the server doesn't have a resource type "deploymnt"`,
	})
	ke, ok := err.(*KcliError)
	if !ok {
		t.Fatalf("expected *KcliError, got %T", err)
	}
	if ke.ErrCode != ErrResourceTypeNotFound {
		t.Fatalf("expected code %s, got %s", ErrResourceTypeNotFound, ke.ErrCode)
	}
}

func TestWrap_Forbidden(t *testing.T) {
	err := Wrap(&runner.KubectlError{
		Args:     []string{"get", "secrets"},
		ExitCode: 1,
		Stderr:   `Error from server (Forbidden): secrets is forbidden: User "test" cannot list resource "secrets"`,
	})
	ke, ok := err.(*KcliError)
	if !ok {
		t.Fatalf("expected *KcliError, got %T", err)
	}
	if ke.ErrCode != ErrPermissionDenied {
		t.Fatalf("expected code %s, got %s", ErrPermissionDenied, ke.ErrCode)
	}
}

func TestWrap_ConnectionRefused(t *testing.T) {
	err := Wrap(&runner.KubectlError{
		Args:     []string{"get", "pods"},
		ExitCode: 1,
		Stderr:   `Unable to connect to the server: dial tcp 127.0.0.1:6443: connection refused`,
	})
	ke, ok := err.(*KcliError)
	if !ok {
		t.Fatalf("expected *KcliError, got %T", err)
	}
	if ke.ErrCode != ErrClusterUnreachable {
		t.Fatalf("expected code %s, got %s", ErrClusterUnreachable, ke.ErrCode)
	}
}

func TestWrap_NilError(t *testing.T) {
	if err := Wrap(nil); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestWrap_UnknownError(t *testing.T) {
	orig := &runner.KubectlError{
		Args:     []string{"something"},
		ExitCode: 1,
		Stderr:   "some unknown error",
	}
	err := Wrap(orig)
	// Should return original when no pattern matches
	if err != orig {
		t.Fatalf("expected original error, got %T: %v", err, err)
	}
}

func TestKcliError_JSON(t *testing.T) {
	e := &KcliError{
		ErrCode: ErrPermissionDenied,
		Message: "forbidden",
		Hint:    "check rbac",
	}
	b, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint"`
		} `json:"error"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Error.Code != string(ErrPermissionDenied) {
		t.Fatalf("expected code %s, got %s", ErrPermissionDenied, parsed.Error.Code)
	}
}

func TestSuggestResourceType(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"deploy", "deployments"},
		{"svc", "services"},
		{"cm", "configmaps"},
		{"unknown_xyz", ""},
	}
	for _, tc := range cases {
		got := suggestResourceType(tc.input)
		if got != tc.want {
			t.Errorf("suggestResourceType(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
