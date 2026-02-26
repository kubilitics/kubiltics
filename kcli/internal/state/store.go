package state

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	stateDirName  = ".kcli"
	stateFileName = "state.json"
	maxRecent     = 10
)

type Store struct {
	LastContext         string              `json:"lastContext,omitempty"`
	RecentContexts      []string            `json:"recentContexts,omitempty"`
	LastNamespace       string              `json:"lastNamespace,omitempty"`
	RecentNamespaces    []string            `json:"recentNamespaces,omitempty"`
	Favorites           []string            `json:"favorites,omitempty"`           // context favorites
	NamespaceFavorites  []string            `json:"namespaceFavorites,omitempty"`  // namespace favorites
	ContextAliases      map[string]string   `json:"contextAliases,omitempty"`      // alias → context name
	ContextGroups       map[string][]string `json:"contextGroups,omitempty"`
	ActiveContextGroup  string              `json:"activeContextGroup,omitempty"`
}

func FilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, stateDirName, stateFileName), nil
}

func Load() (*Store, error) {
	path, err := FilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &Store{}, nil
		}
		return nil, err
	}
	if len(b) == 0 {
		return &Store{}, nil
	}
	var s Store
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func Save(s *Store) error {
	path, err := FilePath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func (s *Store) MarkContextSwitched(previous, current string) {
	if previous != "" && previous != current {
		s.LastContext = previous
	}
	s.RecentContexts = addUniqueFront(s.RecentContexts, current, maxRecent)
}

func (s *Store) MarkNamespaceSwitched(previous, current string) {
	if previous != "" && previous != current {
		s.LastNamespace = previous
	}
	s.RecentNamespaces = addUniqueFront(s.RecentNamespaces, current, maxRecent)
}

func (s *Store) AddFavorite(name string) {
	s.Favorites = addUniqueFront(s.Favorites, name, 200)
}

func (s *Store) RemoveFavorite(name string) {
	out := make([]string, 0, len(s.Favorites))
	for _, v := range s.Favorites {
		if v != name {
			out = append(out, v)
		}
	}
	s.Favorites = out
}

// Namespace favorites

func (s *Store) AddNamespaceFavorite(name string) {
	s.NamespaceFavorites = addUniqueFront(s.NamespaceFavorites, name, 200)
}

func (s *Store) RemoveNamespaceFavorite(name string) {
	out := make([]string, 0, len(s.NamespaceFavorites))
	for _, v := range s.NamespaceFavorites {
		if v != name {
			out = append(out, v)
		}
	}
	s.NamespaceFavorites = out
}

// Context aliases

func (s *Store) SetContextAlias(alias, context string) {
	alias = strings.TrimSpace(alias)
	context = strings.TrimSpace(context)
	if alias == "" || context == "" {
		return
	}
	if s.ContextAliases == nil {
		s.ContextAliases = map[string]string{}
	}
	s.ContextAliases[alias] = context
}

func (s *Store) RemoveContextAlias(alias string) {
	alias = strings.TrimSpace(alias)
	if s.ContextAliases != nil {
		delete(s.ContextAliases, alias)
	}
}

func (s *Store) ResolveContextAlias(nameOrAlias string) string {
	nameOrAlias = strings.TrimSpace(nameOrAlias)
	if s.ContextAliases != nil {
		if resolved, ok := s.ContextAliases[nameOrAlias]; ok {
			return resolved
		}
	}
	return nameOrAlias
}

func (s *Store) SetContextGroup(name string, contexts []string) {
	name = normalizeGroupName(name)
	if name == "" {
		return
	}
	if s.ContextGroups == nil {
		s.ContextGroups = map[string][]string{}
	}
	s.ContextGroups[name] = dedupeOrdered(contexts)
}

func (s *Store) AddContextGroupMembers(name string, contexts []string) {
	name = normalizeGroupName(name)
	if name == "" {
		return
	}
	if s.ContextGroups == nil {
		s.ContextGroups = map[string][]string{}
	}
	base := s.ContextGroups[name]
	s.ContextGroups[name] = dedupeOrdered(append(base, contexts...))
}

func (s *Store) RemoveContextGroupMembers(name string, contexts []string) {
	name = normalizeGroupName(name)
	if name == "" || s.ContextGroups == nil {
		return
	}
	existing, ok := s.ContextGroups[name]
	if !ok {
		return
	}
	if len(contexts) == 0 {
		delete(s.ContextGroups, name)
		if s.ActiveContextGroup == name {
			s.ActiveContextGroup = ""
		}
		return
	}
	rm := map[string]struct{}{}
	for _, c := range contexts {
		c = strings.TrimSpace(c)
		if c != "" {
			rm[c] = struct{}{}
		}
	}
	out := make([]string, 0, len(existing))
	for _, c := range existing {
		if _, found := rm[c]; !found {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		delete(s.ContextGroups, name)
		if s.ActiveContextGroup == name {
			s.ActiveContextGroup = ""
		}
		return
	}
	s.ContextGroups[name] = out
}

func (s *Store) SetActiveContextGroup(name string) {
	name = normalizeGroupName(name)
	if name == "" {
		s.ActiveContextGroup = ""
		return
	}
	if s.ContextGroups == nil {
		s.ActiveContextGroup = ""
		return
	}
	if _, ok := s.ContextGroups[name]; ok {
		s.ActiveContextGroup = name
	}
}

func normalizeGroupName(name string) string {
	return strings.TrimSpace(name)
}

func dedupeOrdered(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func addUniqueFront(list []string, value string, limit int) []string {
	if value == "" {
		return list
	}
	out := make([]string, 0, len(list)+1)
	out = append(out, value)
	for _, item := range list {
		if item != value {
			out = append(out, item)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
