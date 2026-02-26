//go:build !darwin && !linux

package keychain

import "errors"

var ErrUnavailable = errors.New("keychain not available on this platform")

func set(service, account, value string) error {
	_ = service
	_ = account
	_ = value
	return ErrUnavailable
}

func get(service, account string) (string, error) {
	_ = service
	_ = account
	return "", ErrUnavailable
}

func delete(service, account string) error {
	_ = service
	_ = account
	return ErrUnavailable
}

func available() bool {
	return false
}
