package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginInstallListRemoveCommands(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)

	src := t.TempDir()
	bin := filepath.Join(src, "kcli-demo")
	manifest := filepath.Join(src, "plugin.yaml")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho demo\n"), 0o755); err != nil {
		t.Fatalf("write bin: %v", err)
	}
	if err := os.WriteFile(manifest, []byte("name: demo\nversion: 1.0.0\npermissions: []\n"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "install", src})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin install failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Installed plugin") {
		t.Fatalf("unexpected install output: %q", buf.String())
	}

	root = NewRootCommand()
	buf.Reset()
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "list"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin list failed: %v", err)
	}
	if !strings.Contains(buf.String(), "demo") {
		t.Fatalf("expected demo in list output: %q", buf.String())
	}

	root = NewRootCommand()
	buf.Reset()
	root.SetOut(buf)
	root.SetErr(buf)
	root.SetArgs([]string{"plugin", "remove", "demo"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin remove failed: %v", err)
	}
	if !strings.Contains(buf.String(), "Removed plugin") {
		t.Fatalf("unexpected remove output: %q", buf.String())
	}
}

func TestPluginListJSONOutput(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)

	src := t.TempDir()
	bin := filepath.Join(src, "kcli-test")
	manifest := filepath.Join(src, "plugin.yaml")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho test\n"), 0o755); err != nil {
		t.Fatalf("write bin: %v", err)
	}
	if err := os.WriteFile(manifest, []byte("name: test\nversion: 2.0.0\ndescription: test plugin\npermissions: []\n"), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	// Install
	root := NewRootCommand()
	root.SetArgs([]string{"plugin", "install", src})
	root.SetOut(&bytes.Buffer{})
	root.SetErr(&bytes.Buffer{})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin install failed: %v", err)
	}

	// List with -o json
	root = NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(&bytes.Buffer{})
	root.SetArgs([]string{"plugin", "list", "-o", "json"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin list -o json failed: %v", err)
	}

	var entries []pluginListEntry
	if err := json.Unmarshal(buf.Bytes(), &entries); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nraw: %s", err, buf.String())
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 plugin in JSON, got %d", len(entries))
	}
	if entries[0].Name != "test" {
		t.Errorf("expected name 'test', got %q", entries[0].Name)
	}
	if entries[0].Version != "2.0.0" {
		t.Errorf("expected version '2.0.0', got %q", entries[0].Version)
	}
	if entries[0].Status != "ready" {
		t.Errorf("expected status 'ready', got %q", entries[0].Status)
	}
	if entries[0].Description != "test plugin" {
		t.Errorf("expected description 'test plugin', got %q", entries[0].Description)
	}
}

func TestPluginListEmptyNoPlugins(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KCLI_HOME_DIR", home)

	root := NewRootCommand()
	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetErr(&bytes.Buffer{})
	root.SetArgs([]string{"plugin", "list"})
	if err := root.Execute(); err != nil {
		t.Fatalf("plugin list failed: %v", err)
	}
	if !strings.Contains(buf.String(), "No plugins installed") {
		t.Errorf("expected 'No plugins installed' message, got %q", buf.String())
	}
}

