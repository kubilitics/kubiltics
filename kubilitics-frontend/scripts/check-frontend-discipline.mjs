#!/usr/bin/env node
/**
 * check-frontend-discipline.mjs — fail-CI scanner enforcing three rules:
 *
 * 1. Backend path discipline (Option B port architecture, 2026-04-26):
 *    Bare fetch / new WebSocket / new EventSource / new URL calls with a
 *    hardcoded `/api/`, `/ws/`, or `/healthz` path are forbidden. Use
 *    apiUrl() / wsUrl() / eventSourceUrl() from '@/lib/backendUrl'.
 *
 * 2. AI readiness single-source: useAIReady is the only gate UI may consume.
 *    Direct imports of useAIStatus / useAICapabilities / useAIUserConfig
 *    are forbidden outside src/hooks/useAIReady.ts. UI components must
 *    consume useAIReady — the only hook that composes all three.
 *
 * 3. Profile invoke discipline: profile commands (save/list/activate/...)
 *    must go through useAIProfiles / useActiveProfile + AISettingsPage.
 *    Direct invoke('save_profile' | 'list_profiles' | 'activate_profile' | …)
 *    is forbidden outside the helper hooks and AISettingsPage.
 *
 * All rules patch the same kind of bug — multiple sources of truth that
 * silently disagree — so they ship in one scanner. Easy to audit, easy to
 * extend with future single-source-of-truth invariants.
 *
 * Run via:
 *   npm run lint:frontend-discipline
 * Wired into the top-level `npm run lint` script and CI.
 *
 * Per-line escape hatches:
 *   // allow-backend-path     — suppresses rule 1 on the matching line
 *   // allow-direct-ai-hook   — suppresses rule 2 on the matching line
 *   // allow-profile-invoke   — suppresses rule 3 on the matching line
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

// ─── Rule 1: backend paths ────────────────────────────────────────────
const ALLOWED_BACKEND_PATH_FILES = new Set([
  'src/lib/backendUrl.ts',
  'src/services/api/shell.test.ts',
  'src/services/api/client.ts',
]);
const ALLOW_BACKEND_PATH = /\/\/\s*allow-backend-path/;
const BACKEND_PATH_PATTERNS = [
  /\bfetch\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  /\bnew\s+WebSocket\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  /\bnew\s+EventSource\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
  /\bnew\s+URL\s*\(\s*['"`]\/(api|ws|healthz)(?:\/|['"`?])/,
];

// ─── Rule 2: AI hook imports ──────────────────────────────────────────
const ALLOWED_AI_IMPORT_FILES = new Set([
  'src/hooks/useAIReady.ts',
  'src/hooks/useAIReady.test.tsx',
  'src/hooks/useAIStatus.ts',
  'src/hooks/useAIStatus.test.tsx',
  'src/hooks/useAICapabilities.ts',
  'src/hooks/useAIUserConfig.ts',
  'src/hooks/useAIUserConfig.test.ts',
]);
const ALLOW_AI_IMPORT = /\/\/\s*allow-direct-ai-hook/;
// Match `import { ... useAIStatus ... } from '...'` — covers the three names.
const AI_IMPORT_PATTERN = /\bimport\b[^;]*\b(useAIStatus|useAICapabilities|useAIUserConfig)\b[^;]*from\b/;

// ─── Rule 3: Profile commands via invoke ──────────────────────────────
const ALLOWED_PROFILE_INVOKE_FILES = new Set([
  'src/hooks/useAIProfiles.ts',
  'src/hooks/useAIProfiles.test.tsx',
  'src/hooks/useActiveProfile.ts',
  'src/hooks/useActiveProfile.test.tsx',
  'src/pages/settings/AISettingsPage.tsx',
  'src/pages/settings/AISettingsPage.test.tsx',
  'src/pages/settings/AISettingsPage.save.test.tsx',
  'src/App.tsx', // for MigrationToast
]);
const ALLOW_PROFILE_INVOKE = /\/\/\s*allow-profile-invoke/;
// Match invoke('save_profile') | invoke("list_profiles") | invoke(`activate_profile`)
const PROFILE_INVOKE_PATTERN =
  /\binvoke\s*[<(]\s*[^>]*?>?\s*\(?\s*['"`](list_profiles|get_active_profile|save_profile|update_profile|delete_profile|activate_profile|test_profile)['"`]/;

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
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentOnlyLine(line)) continue;

    // Rule 1 — backend paths
    if (
      !ALLOWED_BACKEND_PATH_FILES.has(rel) &&
      !ALLOW_BACKEND_PATH.test(line) &&
      BACKEND_PATH_PATTERNS.some((p) => p.test(line))
    ) {
      violations.push({
        rule: 'backend-path',
        file: rel,
        line: i + 1,
        code: line.trim(),
      });
    }

    // Rule 2 — AI imports
    if (
      !ALLOWED_AI_IMPORT_FILES.has(rel) &&
      !ALLOW_AI_IMPORT.test(line) &&
      AI_IMPORT_PATTERN.test(line)
    ) {
      violations.push({
        rule: 'ai-direct-hook',
        file: rel,
        line: i + 1,
        code: line.trim(),
      });
    }

    // Rule 3 — profile invoke discipline
    if (
      !ALLOWED_PROFILE_INVOKE_FILES.has(rel) &&
      !ALLOW_PROFILE_INVOKE.test(line) &&
      PROFILE_INVOKE_PATTERN.test(line)
    ) {
      violations.push({
        rule: 'profile-direct-invoke',
        file: rel,
        line: i + 1,
        code: line.trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log('check-frontend-discipline: ok (0 violations)');
  process.exit(0);
}

const byRule = violations.reduce((acc, v) => {
  (acc[v.rule] ??= []).push(v);
  return acc;
}, {});

console.error(`check-frontend-discipline: ${violations.length} violation(s)\n`);

if (byRule['backend-path']?.length) {
  console.error(`Rule: backend-path (${byRule['backend-path'].length})`);
  console.error("  Use apiUrl() / wsUrl() / eventSourceUrl() from '@/lib/backendUrl'.");
  console.error('  Per-line escape: `// allow-backend-path`');
  for (const v of byRule['backend-path']) {
    console.error(`  ${v.file}:${v.line}\n    ${v.code}`);
  }
  console.error('');
}
if (byRule['ai-direct-hook']?.length) {
  console.error(`Rule: ai-direct-hook (${byRule['ai-direct-hook'].length})`);
  console.error("  Use useAIReady() from '@/hooks/useAIReady'. Direct imports of");
  console.error('  useAIStatus / useAICapabilities / useAIUserConfig are forbidden');
  console.error('  outside the helper itself (see the allowlist in this script).');
  console.error('  Per-line escape: `// allow-direct-ai-hook`');
  for (const v of byRule['ai-direct-hook']) {
    console.error(`  ${v.file}:${v.line}\n    ${v.code}`);
  }
  console.error('');
}
if (byRule['profile-direct-invoke']?.length) {
  console.error(`Rule: profile-direct-invoke (${byRule['profile-direct-invoke'].length})`);
  console.error("  Use useAIProfiles() / useActiveProfile() from '@/hooks/...'.");
  console.error("  Direct invoke('save_profile' | 'activate_profile' | …) is forbidden");
  console.error('  outside the helper hooks + AISettingsPage. See ALLOWED_PROFILE_INVOKE_FILES.');
  console.error('  Per-line escape: `// allow-profile-invoke`');
  for (const v of byRule['profile-direct-invoke']) {
    console.error(`  ${v.file}:${v.line}\n    ${v.code}`);
  }
  console.error('');
}

process.exit(1);
