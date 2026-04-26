#!/usr/bin/env node
/**
 * check-backend-paths.mjs — fail-CI scanner for hardcoded backend paths.
 *
 * Background: Option B (see src/lib/backendUrl.ts) makes the desktop app
 * resilient to dynamic backend ports by routing every fetch / WebSocket /
 * EventSource through `apiUrl()` / `wsUrl()` / `eventSourceUrl()`. Hardcoded
 * `/api/...`, `/ws/...`, or `/healthz` literals only ever worked because
 * the old Vite dev proxy intercepted them — that proxy is gone.
 *
 * What this scanner flags (precise — to avoid false positives, which would
 * train people to ignore the rule):
 *
 *   1. fetch('/api/...') | fetch("/api/...") | fetch(`/api/...`)
 *   2. new WebSocket('/api/...' | '/ws/...' | template literal)
 *   3. new EventSource('/api/...' | template literal)
 *   4. new URL('/api/...' | '/ws/...', anything)
 *
 *   Same for /ws/ and /healthz prefixes.
 *
 * What this scanner does NOT flag:
 *   - apiUrl('/api/...') / wsUrl('/api/...') / eventSourceUrl('/api/...')
 *     — the path argument to the helper is allowed.
 *   - Constants like `const API_PREFIX = '/api/v1'` (used inside helpers).
 *   - Template literals interpolating a base, e.g. `${baseUrl}/api/...` —
 *     these are migrated separately and aren't a Vite-proxy regression.
 *
 * Allowlist:
 *   - Files matching ALLOWED_FILES below (the helper itself + tests + docs).
 *   - Lines containing the exact comment `// allow-backend-path`.
 *
 * Run via:
 *   npm run lint:backend-paths
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const ALLOWED_FILES = new Set([
  'src/lib/backendUrl.ts',
  'src/services/api/shell.test.ts',
  'src/services/api/client.ts', // exports API_PREFIX = '/api/v1'
]);

const ALLOW_LINE = /\/\/\s*allow-backend-path/;

// Pattern: a CALL we care about (fetch/new WebSocket/new EventSource/new URL)
// followed by a quoted backend path as the first argument.
const PATTERNS = [
  // fetch('/api/...') | fetch("/api/...") | fetch(`/api/...`)
  /\bfetch\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  // new WebSocket('/api/...') | new WebSocket(`/ws/...`) etc.
  /\bnew\s+WebSocket\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  // new EventSource('/api/...')
  /\bnew\s+EventSource\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  // new URL('/api/...', ...)
  /\bnew\s+URL\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
];

function listFiles() {
  const out = execSync(
    `find "${SRC}" \\( -name "*.ts" -o -name "*.tsx" \\) -not -path "*/node_modules/*"`,
    { encoding: 'utf8' }
  );
  return out.split('\n').filter(Boolean);
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const violations = [];
for (const abs of listFiles()) {
  const rel = relative(ROOT, abs);
  if (ALLOWED_FILES.has(rel)) continue;
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentOnlyLine(line)) continue;
    if (ALLOW_LINE.test(line)) continue;
    if (PATTERNS.some((p) => p.test(line))) {
      violations.push({ file: rel, line: i + 1, code: line.trim() });
    }
  }
}

if (violations.length === 0) {
  console.log('check-backend-paths: ok (0 violations)');
  process.exit(0);
}

console.error(`check-backend-paths: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.code}`);
}
console.error(
  "\nUse apiUrl() / wsUrl() / eventSourceUrl() from '@/lib/backendUrl' instead.\n" +
    'If a literal is genuinely required (e.g. in a test), add `// allow-backend-path` at end of line.\n'
);
process.exit(1);
