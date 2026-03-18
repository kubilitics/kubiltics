// Package filelock provides cross-platform file locking using atomic lock files.
//
// This avoids Unix-only syscall.Flock, making it work on Windows, macOS, and Linux.
// The locking strategy uses O_CREATE|O_EXCL which is atomic on all major OSes and
// filesystems.
package filelock

import (
	"fmt"
	"os"
	"time"
)

// staleLockAge is the threshold after which a lock file is considered stale
// and can be forcibly removed. This handles the case where a process crashed
// while holding the lock.
const staleLockAge = 30 * time.Second

// WithFileLock acquires an exclusive lock on path+".lock", runs fn, then releases.
// If the lock cannot be acquired, fn is run without the lock (best-effort fallback).
func WithFileLock(path string, fn func() error) error {
	lockPath := path + ".lock"
	_ = os.MkdirAll(dirOf(lockPath), 0o755)

	unlock, err := acquire(lockPath)
	if err != nil {
		// Fallback: run without lock rather than failing entirely.
		return fn()
	}
	defer unlock()
	return fn()
}

// acquire tries to create the lock file atomically. If the lock file already
// exists, it checks whether it is stale (older than staleLockAge) and removes
// it before retrying once.
func acquire(lockPath string) (unlock func(), err error) {
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		if !os.IsExist(err) {
			return nil, err
		}
		// Lock file exists — check for staleness.
		if removeIfStale(lockPath) {
			// Retry once after removing stale lock.
			f, err = os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, fmt.Errorf("lock held: %s", lockPath)
		}
	}
	f.Close()

	return func() {
		os.Remove(lockPath) //nolint:errcheck
	}, nil
}

// removeIfStale removes the lock file if it is older than staleLockAge.
// Returns true if the file was removed (or already gone).
func removeIfStale(lockPath string) bool {
	info, err := os.Stat(lockPath)
	if err != nil {
		return os.IsNotExist(err)
	}
	if time.Since(info.ModTime()) > staleLockAge {
		os.Remove(lockPath) //nolint:errcheck
		return true
	}
	return false
}

// dirOf returns the directory portion of path, same as filepath.Dir but
// avoids importing filepath for this one use.
func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}
