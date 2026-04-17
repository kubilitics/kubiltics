package agenttoken

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	issuer       = "kubilitics-hub"
	typBootstrap = "bootstrap"
	typAccess    = "access"
)

type Signer struct{ secret []byte }

func NewSigner(secret []byte) *Signer {
	if len(secret) < 32 {
		panic("agenttoken: signing secret must be >= 32 bytes")
	}
	return &Signer{secret: secret}
}

type BootstrapClaims struct {
	JTI       string
	OrgID     string
	CreatedBy string
	TTL       time.Duration
}

type AccessClaims struct {
	ClusterID string
	OrgID     string
	Epoch     int
	TTL       time.Duration
}

func (s *Signer) IssueBootstrap(c BootstrapClaims) (string, error) {
	now := time.Now()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":        issuer,
		"typ":        typBootstrap,
		"jti":        c.JTI,
		"org_id":     c.OrgID,
		"created_by": c.CreatedBy,
		"iat":        now.Unix(),
		"exp":        now.Add(c.TTL).Unix(),
	})
	return t.SignedString(s.secret)
}

func (s *Signer) VerifyBootstrap(tok string) (*BootstrapClaims, error) {
	claims, err := s.parse(tok, typBootstrap)
	if err != nil { return nil, err }
	return &BootstrapClaims{
		JTI:       getString(claims, "jti"),
		OrgID:     getString(claims, "org_id"),
		CreatedBy: getString(claims, "created_by"),
	}, nil
}

func (s *Signer) IssueAccess(c AccessClaims) (string, error) {
	now := time.Now()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":    issuer,
		"typ":    typAccess,
		"sub":    c.ClusterID,
		"org_id": c.OrgID,
		"epoch":  c.Epoch,
		"scope":  "agent",
		"iat":    now.Unix(),
		"exp":    now.Add(c.TTL).Unix(),
	})
	return t.SignedString(s.secret)
}

func (s *Signer) VerifyAccess(tok string) (*AccessClaims, error) {
	claims, err := s.parse(tok, typAccess)
	if err != nil { return nil, err }
	epoch, _ := claims["epoch"].(float64)
	return &AccessClaims{
		ClusterID: getString(claims, "sub"),
		OrgID:     getString(claims, "org_id"),
		Epoch:     int(epoch),
	}, nil
}

func (s *Signer) parse(tok, expectedTyp string) (jwt.MapClaims, error) {
	parsed, err := jwt.Parse(tok, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != "HS256" {
			return nil, fmt.Errorf("unexpected alg %s", t.Method.Alg())
		}
		return s.secret, nil
	})
	if err != nil { return nil, err }
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok || !parsed.Valid { return nil, errors.New("invalid token") }
	if getString(claims, "iss") != issuer { return nil, errors.New("bad issuer") }
	if getString(claims, "typ") != expectedTyp { return nil, errors.New("wrong token type") }
	return claims, nil
}

func getString(c jwt.MapClaims, k string) string {
	v, _ := c[k].(string)
	return v
}
