package agenttoken

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSignAndVerifyBootstrap(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	jti := uuid.NewString()
	tok, err := s.IssueBootstrap(BootstrapClaims{
		JTI: jti, OrgID: "org1", CreatedBy: "user1", TTL: time.Hour,
	})
	if err != nil { t.Fatal(err) }
	got, err := s.VerifyBootstrap(tok)
	if err != nil { t.Fatalf("verify: %v", err) }
	if got.JTI != jti || got.OrgID != "org1" {
		t.Fatalf("claims mismatch: %+v", got)
	}
}

func TestVerifyBootstrap_Expired(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	tok, _ := s.IssueBootstrap(BootstrapClaims{
		JTI: uuid.NewString(), OrgID: "o", CreatedBy: "u", TTL: -time.Second,
	})
	if _, err := s.VerifyBootstrap(tok); err == nil {
		t.Fatal("expected expired error")
	}
}

func TestVerifyBootstrap_BadSig(t *testing.T) {
	s1 := NewSigner([]byte("secret-A-padding-padding-padding"))
	s2 := NewSigner([]byte("secret-B-padding-padding-padding"))
	tok, _ := s1.IssueBootstrap(BootstrapClaims{
		JTI: uuid.NewString(), OrgID: "o", CreatedBy: "u", TTL: time.Hour,
	})
	if _, err := s2.VerifyBootstrap(tok); err == nil {
		t.Fatal("expected signature error")
	}
}

func TestSignAndVerifyAccess(t *testing.T) {
	s := NewSigner([]byte("test-secret-min-32-bytes-aaaaaaaa"))
	tok, err := s.IssueAccess(AccessClaims{
		ClusterID: "c1", OrgID: "o1", Epoch: 3, TTL: time.Hour,
	})
	if err != nil { t.Fatal(err) }
	got, err := s.VerifyAccess(tok)
	if err != nil { t.Fatal(err) }
	if got.ClusterID != "c1" || got.Epoch != 3 {
		t.Fatalf("got %+v", got)
	}
}
