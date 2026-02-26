//go:build linux

package keychain

import (
	"errors"
	"os/exec"
	"strings"
)

var ErrUnavailable = errors.New("Secret Service unavailable (secret-tool not found or failed)")

func set(service, account, value string) error {
	cmd := exec.Command("secret-tool", "store", "--label=kcli", "service", service, "account", account)
	cmd.Stdin = strings.NewReader(value)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Join(ErrUnavailable, err, errOutput(out))
	}
	return nil
}

func get(service, account string) (string, error) {
	cmd := exec.Command("secret-tool", "lookup", "service", service, "account", account)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if cmd.ProcessState != nil && !cmd.ProcessState.Success() && strings.Contains(string(out), "No matching secret") {
			return "", nil
		}
		return "", errors.Join(ErrUnavailable, err, errOutput(out))
	}
	return strings.TrimSuffix(string(out), "\n"), nil
}

func delete(service, account string) error {
	cmd := exec.Command("secret-tool", "clear", "service", service, "account", account)
	_ = cmd.Run()
	return nil
}

func available() bool {
	_, err := exec.LookPath("secret-tool")
	return err == nil
}

func errOutput(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	return errors.New(strings.TrimSpace(string(b)))
}
