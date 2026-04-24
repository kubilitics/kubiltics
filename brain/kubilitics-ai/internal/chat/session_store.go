// Package chat provides chat-session persistence for the Kubilitics AI
// brain. Messages survive process restart so a user who closes the app
// and reopens it mid-conversation lands back in their prior session with
// full history intact.
//
// Storage: SQLite via modernc.org/sqlite (pure-Go, no CGO). Schema is
// independent of internal/db so this store can be opened on any path
// without coupling to the wider persistence stack.
package chat

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

// Message is a single chat message — user, assistant, or tool — belonging
// to a session.
type Message struct {
	Role          string    `json:"role"`    // "user" | "assistant" | "system" | "tool"
	Content       string    `json:"content"` // textual body
	ToolCallsJSON string    `json:"tool_calls,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// SessionStore is the minimal chat-history contract.
//
// Append records one message to the end of a session's timeline.
// Load returns all messages for a session in insertion order (stable
// primary-key ordering). An unknown session_id returns an empty slice
// without error.
type SessionStore interface {
	Append(ctx context.Context, sessionID string, msg Message) error
	Load(ctx context.Context, sessionID string) ([]Message, error)
	Close() error
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_session ON chat_messages(session_id, id);
`

// SQLiteSessionStore is the SQLite-backed SessionStore.
type SQLiteSessionStore struct {
	db *sql.DB
	mu sync.Mutex
}

// NewSQLiteSessionStore opens (or creates) the SQLite file at path and
// applies the schema. modernc.org/sqlite is CGO-free and portable.
func NewSQLiteSessionStore(path string) (*SQLiteSessionStore, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite at %q: %w", path, err)
	}
	// Keep the pool small — chat writes are not high-fanout.
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(context.Background(), schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply chat schema: %w", err)
	}
	return &SQLiteSessionStore{db: db}, nil
}

// Append writes a message to a session.
func (s *SQLiteSessionStore) Append(ctx context.Context, sessionID string, msg Message) error {
	if sessionID == "" {
		return fmt.Errorf("session_id required")
	}
	if msg.Role == "" {
		return fmt.Errorf("message role required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO chat_messages (session_id, role, content, tool_calls_json) VALUES (?, ?, ?, ?)`,
		sessionID, msg.Role, msg.Content, nullableStr(msg.ToolCallsJSON))
	if err != nil {
		return fmt.Errorf("append chat message: %w", err)
	}
	return nil
}

// Load reads all messages for a session ordered by primary key.
func (s *SQLiteSessionStore) Load(ctx context.Context, sessionID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT role, content, COALESCE(tool_calls_json, ''), created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC`,
		sessionID)
	if err != nil {
		return nil, fmt.Errorf("load chat messages: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		var unix int64
		if err := rows.Scan(&m.Role, &m.Content, &m.ToolCallsJSON, &unix); err != nil {
			return nil, err
		}
		m.CreatedAt = time.Unix(unix, 0)
		out = append(out, m)
	}
	return out, rows.Err()
}

// Close releases the underlying DB.
func (s *SQLiteSessionStore) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

// DeriveSessionID produces a stable session identifier from (cluster_id,
// user_id). Used by multi-cluster isolation — the same pair always maps
// to the same session, different pairs diverge.
//
// Returns an error when clusterID is empty: otherwise all anonymous
// sessions would collide into one shared transcript, leaking context
// across unrelated users and clusters.
func DeriveSessionID(clusterID, userID string) (string, error) {
	if strings.TrimSpace(clusterID) == "" {
		return "", errors.New("cluster_id must not be empty")
	}
	sum := sha256.Sum256([]byte(clusterID + "|" + userID))
	return "chat-" + hex.EncodeToString(sum[:16]), nil
}

func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
