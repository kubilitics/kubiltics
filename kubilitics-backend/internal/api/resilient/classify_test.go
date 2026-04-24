package resilient

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/url"
	"syscall"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestIsTransient_ContextDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Nanosecond)
	if !IsTransientClusterError(ctx.Err()) {
		t.Fatal("context.DeadlineExceeded should be transient")
	}
}

func TestIsTransient_ConnectionRefused(t *testing.T) {
	err := &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}
	if !IsTransientClusterError(err) {
		t.Fatal("connection refused should be transient")
	}
}

func TestIsTransient_DNSFailure(t *testing.T) {
	err := &net.DNSError{Err: "no such host", Name: "apiserver.example.com", IsNotFound: true}
	if !IsTransientClusterError(err) {
		t.Fatal("DNS lookup failure should be transient")
	}
}

func TestIsTransient_TLSHandshake(t *testing.T) {
	var err error = &tls.CertificateVerificationError{Err: errors.New("x509: certificate signed by unknown authority")}
	if !IsTransientClusterError(err) {
		t.Fatal("TLS handshake failure should be transient")
	}
}

func TestIsTransient_K8sUnauthorized(t *testing.T) {
	err := apierrors.NewUnauthorized("token expired")
	if !IsTransientClusterError(err) {
		t.Fatal("401 Unauthorized should be transient")
	}
}

func TestIsTransient_K8sServiceUnavailable(t *testing.T) {
	err := apierrors.NewServiceUnavailable("apiserver restarting")
	if !IsTransientClusterError(err) {
		t.Fatal("503 should be transient")
	}
}

func TestIsTransient_UrlError(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://x", Err: context.DeadlineExceeded}
	if !IsTransientClusterError(err) {
		t.Fatal("wrapped url.Error with transient cause should be transient")
	}
}

func TestIsTransient_RealBugNotTransient(t *testing.T) {
	// A NotFound on a specific resource is NOT cluster-unreachable.
	err := apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "mypod")
	if IsTransientClusterError(err) {
		t.Fatal("404 on resource should NOT be classified as cluster-unreachable")
	}
}

func TestIsTransient_NilErrIsFalse(t *testing.T) {
	if IsTransientClusterError(nil) {
		t.Fatal("nil err is not transient")
	}
}

func TestIsTransient_RandomErr(t *testing.T) {
	if IsTransientClusterError(fmt.Errorf("something totally random")) {
		t.Fatal("unrecognized err should not be transient (safe default)")
	}
}
