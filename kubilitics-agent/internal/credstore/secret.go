package credstore

import (
	"context"
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	apierr "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type Creds struct {
	ClusterID    string
	RefreshToken string
	AccessToken  string
	AccessTTLs   int
}

type Store struct {
	cs        kubernetes.Interface
	namespace string
	name      string
}

func New(cs kubernetes.Interface, namespace, name string) *Store {
	return &Store{cs: cs, namespace: namespace, name: name}
}

func (s *Store) Save(ctx context.Context, c Creds) error {
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: s.name, Namespace: s.namespace},
		Type:       corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"cluster_id":    []byte(c.ClusterID),
			"refresh_token": []byte(c.RefreshToken),
			"access_token":  []byte(c.AccessToken),
			"access_ttl_s":  []byte(strconv.Itoa(c.AccessTTLs)),
		},
	}
	_, err := s.cs.CoreV1().Secrets(s.namespace).Create(ctx, sec, metav1.CreateOptions{})
	if apierr.IsAlreadyExists(err) {
		_, err = s.cs.CoreV1().Secrets(s.namespace).Update(ctx, sec, metav1.UpdateOptions{})
	}
	return err
}

func (s *Store) Load(ctx context.Context) (Creds, error) {
	sec, err := s.cs.CoreV1().Secrets(s.namespace).Get(ctx, s.name, metav1.GetOptions{})
	if err != nil {
		return Creds{}, err
	}
	get := func(k string) string { return string(sec.Data[k]) }
	ttl, _ := strconv.Atoi(get("access_ttl_s"))
	if get("cluster_id") == "" || get("refresh_token") == "" {
		return Creds{}, fmt.Errorf("incomplete secret")
	}
	return Creds{
		ClusterID:    get("cluster_id"),
		RefreshToken: get("refresh_token"),
		AccessToken:  get("access_token"),
		AccessTTLs:   ttl,
	}, nil
}
