package certs

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"testing"
)

func TestMintProducesValidChain(t *testing.T) {
	bundle, err := Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if len(bundle.CAPEM) == 0 || len(bundle.ServerCertPEM) == 0 ||
		len(bundle.ServerKeyPEM) == 0 || len(bundle.ClientCertPEM) == 0 ||
		len(bundle.ClientKeyPEM) == 0 {
		t.Fatalf("bundle has empty fields: %+v", bundle)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(bundle.CAPEM) {
		t.Fatalf("AppendCertsFromPEM(CA) failed")
	}
	clientPair, err := tls.X509KeyPair(bundle.ClientCertPEM, bundle.ClientKeyPEM)
	if err != nil {
		t.Fatalf("X509KeyPair(client): %v", err)
	}
	leaf, err := x509.ParseCertificate(clientPair.Certificate[0])
	if err != nil {
		t.Fatalf("ParseCertificate(client leaf): %v", err)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:     caPool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		t.Fatalf("client cert verify: %v", err)
	}
}

func TestMintEachCallIsFresh(t *testing.T) {
	a, _ := Mint()
	b, _ := Mint()
	if string(a.CAPEM) == string(b.CAPEM) {
		t.Fatalf("two Mint() calls produced identical CA — must be fresh per spawn")
	}
}

func TestStdinBlobRoundtrip(t *testing.T) {
	bundle, err := Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	var buf bytes.Buffer
	if err := WriteStdinBlob(&buf, bundle); err != nil {
		t.Fatalf("WriteStdinBlob: %v", err)
	}
	got, err := ReadStdinBlob(&buf)
	if err != nil {
		t.Fatalf("ReadStdinBlob: %v", err)
	}
	if string(got.CAPEM) != string(bundle.CAPEM) ||
		string(got.ServerCertPEM) != string(bundle.ServerCertPEM) ||
		string(got.ServerKeyPEM) != string(bundle.ServerKeyPEM) {
		t.Fatalf("roundtrip mismatch")
	}
}
