//go:build darwin

package keychain

import (
	"errors"
	"os/exec"
	"strings"
)

var ErrUnavailable = errors.New("macOS Keychain unavailable (security(1) not found or failed)")

func set(service, account, value string) error {
	cmd := exec.Command("security", "add-generic-password",
		"-s", service,
		"-a", account,
		"-w", value,
		"-U", // update if exists
	)
	cmd.Stdin = nil
	out, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "could not be found") {
			// -U with update failed; try delete then add
			_ = delete(service, account)
			return set(service, account, value)
		}
		return errors.Join(ErrUnavailable, err, errOutput(out))
	}
	return nil
}

func get(service, account string) (string, error) {
	cmd := exec.Command("security", "find-generic-password",
		"-s", service,
		"-a", account,
		"-w",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "could not be found") {
			return "", nil
		}
		return "", errors.Join(ErrUnavailable, err, errOutput(out))
	}
	return strings.TrimSuffix(string(out), "\n"), nil
}

func delete(service, account string) error {
	cmd := exec.Command("security", "delete-generic-password",
		"-s", service,
		"-a", account,
	)
	_ = cmd.Run() // ignore error (e.g. item not found)
	return nil
}

func available() bool {
	_, err := exec.LookPath("security")
	return err == nil
}

func errOutput(b []byte) error {
	if len(b) == 0 {
		return nil
	}
	return errors.New(strings.TrimSpace(string(b)))
}
