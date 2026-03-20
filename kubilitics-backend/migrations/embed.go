// Package migrations embeds all SQL migration files so the binary is self-contained.
// This is required for the Tauri sidecar, which runs with an unpredictable working
// directory where ./migrations/ does not exist.
package migrations

import "embed"

// FS contains all *.sql migration files embedded at compile time.
//
//go:embed *.sql
var FS embed.FS
