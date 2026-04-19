// Package certs mints a per-spawn ephemeral CA + server cert + client cert
// for the localhost mTLS handshake between the backend supervisor and the
// kotg-ai-server sidecar. Nothing in this package writes to disk.
package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"time"
)

// Bundle holds the in-memory PEM blobs needed for a single sidecar spawn.
type Bundle struct {
	CAPEM         []byte
	ServerCertPEM []byte
	ServerKeyPEM  []byte
	ClientCertPEM []byte
	ClientKeyPEM  []byte
}

// Mint generates a fresh CA + server cert + client cert. Certs are valid
// for 24h (we expect spawns to be ephemeral, but 24h leaves ample room).
func Mint() (*Bundle, error) {
	notBefore := time.Now().Add(-1 * time.Minute)
	notAfter := notBefore.Add(24 * time.Hour)

	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("gen ca key: %w", err)
	}
	caTpl := &x509.Certificate{
		SerialNumber:          serial(),
		Subject:               pkix.Name{CommonName: "kotg-ai-supervisor-ca"},
		NotBefore:             notBefore, NotAfter: notAfter,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true, IsCA: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	if err != nil {
		return nil, fmt.Errorf("create ca cert: %w", err)
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})

	serverPEM, serverKeyPEM, err := signLeaf(caTpl, caKey, "kotg-ai-server",
		[]x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		[]net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
		[]string{"localhost"})
	if err != nil {
		return nil, err
	}
	clientPEM, clientKeyPEM, err := signLeaf(caTpl, caKey, "kotg-ai-client",
		[]x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, nil, nil)
	if err != nil {
		return nil, err
	}

	return &Bundle{
		CAPEM:         caPEM,
		ServerCertPEM: serverPEM, ServerKeyPEM: serverKeyPEM,
		ClientCertPEM: clientPEM, ClientKeyPEM: clientKeyPEM,
	}, nil
}

func signLeaf(caTpl *x509.Certificate, caKey *ecdsa.PrivateKey, cn string,
	eku []x509.ExtKeyUsage, ips []net.IP, dns []string) ([]byte, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	tpl := &x509.Certificate{
		SerialNumber: serial(),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    caTpl.NotBefore, NotAfter: caTpl.NotAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  eku,
		IPAddresses:  ips, DNSNames: dns,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, caTpl, &key.PublicKey, caKey)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

func serial() *big.Int {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return new(big.Int).SetBytes(b)
}

// WriteStdinBlob writes the bundle to w in length-prefixed framing:
//
//	[4-byte BE length][payload]  for each of CA, server cert, server key.
//
// (The client cert/key never leave the supervisor.)
func WriteStdinBlob(w io.Writer, b *Bundle) error {
	for _, part := range [][]byte{b.CAPEM, b.ServerCertPEM, b.ServerKeyPEM} {
		var hdr [4]byte
		binary.BigEndian.PutUint32(hdr[:], uint32(len(part)))
		if _, err := w.Write(hdr[:]); err != nil {
			return err
		}
		if _, err := w.Write(part); err != nil {
			return err
		}
	}
	return nil
}

// ReadStdinBlob is the inverse, used by both the test and the
// kotg-ai-server binary when it reads its certs at startup.
func ReadStdinBlob(r io.Reader) (*Bundle, error) {
	parts := make([][]byte, 3)
	for i := range parts {
		var hdr [4]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			return nil, fmt.Errorf("read length: %w", err)
		}
		n := binary.BigEndian.Uint32(hdr[:])
		if n > 1<<20 {
			return nil, fmt.Errorf("payload too large: %d bytes", n)
		}
		buf := make([]byte, n)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, fmt.Errorf("read payload: %w", err)
		}
		parts[i] = buf
	}
	return &Bundle{CAPEM: parts[0], ServerCertPEM: parts[1], ServerKeyPEM: parts[2]}, nil
}
