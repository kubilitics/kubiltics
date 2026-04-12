package cli

import (
	"reflect"
	"strings"
	"testing"
)

func TestIsDestructiveExecCmd(t *testing.T) {
	tests := []struct {
		cmd  []string
		want bool
	}{
		{[]string{"rm", "-rf", "/data"}, true},
		{[]string{"ls", "-la"}, false},
		{[]string{"sh", "-c", "rm -rf /data"}, true},
		{[]string{"bash", "-c", "rm -rf /"}, true},
		{[]string{"/bin/sh", "-c", "dd if=/dev/zero of=/dev/sda"}, true},
		{[]string{"sh", "-c", "echo hello"}, false},
		{[]string{"cat", "/etc/passwd"}, false},
		{[]string{"kubectl", "delete", "pod", "test"}, true},
	}
	for _, tc := range tests {
		name := strings.Join(tc.cmd, " ")
		t.Run(name, func(t *testing.T) {
			got := isDestructiveExecCmd(tc.cmd)
			if got != tc.want {
				t.Errorf("isDestructiveExecCmd(%v) = %v, want %v", tc.cmd, got, tc.want)
			}
		})
	}
}

func TestHasContainerFlag(t *testing.T) {
	tests := []struct {
		args []string
		want bool
	}{
		{[]string{"get", "pods"}, false},
		{[]string{"exec", "pod1", "-c", "shell"}, true},
		{[]string{"exec", "pod1", "--container", "shell"}, true},
		{[]string{"exec", "pod1", "--container=shell"}, true},
	}
	for _, tt := range tests {
		if got := hasContainerFlag(tt.args); got != tt.want {
			t.Errorf("hasContainerFlag(%v) = %v; want %v", tt.args, got, tt.want)
		}
	}
}

func TestInsertContainerFlag(t *testing.T) {
	tests := []struct {
		args      []string
		container string
		want      []string
	}{
		{
			[]string{"pod1", "ls"},
			"main",
			[]string{"pod1", "-c", "main", "ls"},
		},
		{
			[]string{"-i", "pod1"},
			"main",
			[]string{"-i", "pod1", "-c", "main"},
		},
		{
			[]string{},
			"main",
			[]string{"-c", "main"},
		},
	}
	for _, tt := range tests {
		if got := insertContainerFlag(tt.args, tt.container); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("insertContainerFlag(%v, %s) = %v; want %v", tt.args, tt.container, got, tt.want)
		}
	}
}
