package resilient

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/url"
	"strings"
	"syscall"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// IsTransientClusterError reports whether err indicates the *cluster*
// is temporarily unreachable or misconfigured, as opposed to a real
// server bug or a genuine 4xx about a specific resource. Transient
// errors MUST produce HTTP 200 + Reachable:false, never 5xx.
//
// Conservative default: unknown errors return false so they surface
// as 5xx and get investigated.
func IsTransientClusterError(err error) bool {
	if err == nil {
		return false
	}

	// context.DeadlineExceeded / Canceled — request timed out talking to apiserver.
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}

	// Network errors: connection refused, reset, no route, DNS lookup failures.
	var netErr *net.OpError
	if errors.As(err, &netErr) {
		return true
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return true
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.EHOSTUNREACH,
			syscall.ENETUNREACH, syscall.ETIMEDOUT:
			return true
		}
	}

	// TLS handshake failures — rotated certs, clock skew, unknown CA.
	var tlsErr *tls.CertificateVerificationError
	if errors.As(err, &tlsErr) {
		return true
	}
	if strings.Contains(err.Error(), "tls: ") || strings.Contains(err.Error(), "x509:") {
		return true
	}

	// url.Error wraps many of the above; check the inner cause.
	var uerr *url.Error
	if errors.As(err, &uerr) && uerr.Err != nil && uerr.Err != err && IsTransientClusterError(uerr.Err) {
		return true
	}

	// Kubernetes API: unauthorized (expired token), service unavailable.
	// NotFound/Conflict/BadRequest are NOT transient — they're about specific resources.
	if apierrors.IsUnauthorized(err) || apierrors.IsServiceUnavailable(err) ||
		apierrors.IsServerTimeout(err) || apierrors.IsTooManyRequests(err) ||
		apierrors.IsInternalError(err) {
		return true
	}

	// Cluster registration errors from resolveClusterID / GetOrReconnectClient.
	// These are not server bugs — the cluster ID is unknown or reconnect failed.
	// Return 200+reachable:false rather than 500 so the frontend sees a clean
	// "unreachable" state instead of an opaque internal error.
	msg := err.Error()
	if strings.Contains(msg, "cluster not found") ||
		strings.Contains(msg, "failed to create client") ||
		strings.Contains(msg, "failed to reconnect") {
		return true
	}

	return false
}
