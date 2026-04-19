package aiclient

import "time"

type ConnectionState int

const (
	StateIdle ConnectionState = iota
	StateConnecting
	StateOpen
	StateError
)

func (s ConnectionState) String() string {
	switch s {
	case StateIdle:
		return "idle"
	case StateConnecting:
		return "connecting"
	case StateOpen:
		return "open"
	case StateError:
		return "error"
	}
	return "unknown"
}

type ClientOpts struct {
	DialTimeout       time.Duration
	UnaryTimeout      time.Duration
	StreamMaxDuration time.Duration
	KeepaliveTime     time.Duration
	KeepaliveTimeout  time.Duration
}

func DefaultOpts() ClientOpts {
	return ClientOpts{
		DialTimeout:       5 * time.Second,
		UnaryTimeout:      10 * time.Second,
		StreamMaxDuration: 600 * time.Second,
		KeepaliveTime:     20 * time.Second,
		KeepaliveTimeout:  10 * time.Second,
	}
}
