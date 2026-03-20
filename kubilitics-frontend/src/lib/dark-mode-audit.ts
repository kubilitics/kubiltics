/**
 * Dark Mode Audit Script — TASK-CORE-003
 *
 * Comprehensive scanner for all .tsx component files to detect dark mode issues:
 *   1. Missing `dark:` class variants for light-mode-only Tailwind classes
 *   2. Hard-coded colors (hex, rgb, hsl literals) that need dark variants
 *   3. `bg-white` without a `dark:bg-*` counterpart on the same element
 *   4. Light-only text/border colors without `dark:` variants
 *   5. Inline style colors that bypass Tailwind dark mode
 *
 * Usage:
 *   import { auditDarkMode } from '@/lib/dark-mode-audit';
 *   const report = auditDarkMode(fileMap);
 *   console.table(report.summary);
 *
 * The audit is purely static — it parses class strings and inline styles
 * from .tsx source text. It does NOT execute components or access the DOM.
 */

/* ─── Types ─── */

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCategory =
  | 'missing-dark-variant'
  | 'hardcoded-color'
  | 'bg-white-no-dark'
  | 'text-color-no-dark'
  | 'border-color-no-dark'
  | 'inline-style-color'
  | 'opacity-only-light';

export interface DarkModeIssue {
  file: string;
  line: number;
  column: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  /** The offending class or style value */
  value: string;
  /** Suggested fix */
  suggestion: string;
}

export interface FileAuditResult {
  file: string;
  issueCount: number;
  issues: DarkModeIssue[];
}

export interface DarkModeAuditReport {
  /** ISO timestamp of when the audit ran */
  timestamp: string;
  /** Total .tsx files scanned */
  filesScanned: number;
  /** Files with at least one issue */
  filesWithIssues: number;
  /** Total issues found */
  totalIssues: number;
  /** Breakdown by severity */
  bySeverity: Record<IssueSeverity, number>;
  /** Breakdown by category */
  byCategory: Record<IssueCategory, number>;
  /** Per-file results (only files with issues) */
  results: FileAuditResult[];
  /** Summary suitable for console.table */
  summary: Array<{
    file: string;
    errors: number;
    warnings: number;
    info: number;
    total: number;
  }>;
}

/* ─── Constants ─── */

/**
 * Light-mode Tailwind bg classes that MUST have a dark: counterpart.
 * Regex captures the class name for reporting.
 */
const LIGHT_BG_NEEDING_DARK: RegExp[] = [
  /\bbg-white\b/,
  /\bbg-slate-50\b/,
  /\bbg-slate-100\b/,
  /\bbg-gray-50\b/,
  /\bbg-gray-100\b/,
  /\bbg-zinc-50\b/,
  /\bbg-zinc-100\b/,
  /\bbg-neutral-50\b/,
  /\bbg-neutral-100\b/,
];

/**
 * Light-mode text classes that need dark variants.
 */
const LIGHT_TEXT_NEEDING_DARK: RegExp[] = [
  /\btext-slate-[789]\d{2}\b/,
  /\btext-gray-[789]\d{2}\b/,
  /\btext-zinc-[789]\d{2}\b/,
  /\btext-black\b/,
];

/**
 * Light-mode border classes that need dark variants.
 */
const LIGHT_BORDER_NEEDING_DARK: RegExp[] = [
  /\bborder-slate-[12]\d{2}\b/,
  /\bborder-gray-[12]\d{2}\b/,
  /\bborder-white\b/,
];

/**
 * Hard-coded color patterns in className strings or inline styles.
 */
const HARDCODED_COLOR_PATTERNS: RegExp[] = [
  // Hex colors in style attributes
  /style=\{[^}]*#[0-9a-fA-F]{3,8}/,
  // rgb/rgba in style attributes
  /style=\{[^}]*rgba?\(\s*\d/,
  // hsl/hsla in style attributes (allow CSS var references)
  /style=\{[^}]*hsla?\(\s*\d/,
];

/**
 * Files/paths to skip (tests, stories, mocks, generated types).
 */
const SKIP_PATTERNS: RegExp[] = [
  /\.test\.(ts|tsx)$/,
  /\.stories\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /\/mocks\//,
  /\/types\//,
  /\/__tests__\//,
  /\.d\.ts$/,
  /vite-env\.d\.ts$/,
];

/**
 * Semantic classes that already handle dark mode via CSS variables.
 * If these are present, the element is considered "dark-mode safe."
 */
const SEMANTIC_SAFE_CLASSES = [
  'bg-background',
  'bg-foreground',
  'bg-card',
  'bg-popover',
  'bg-muted',
  'bg-accent',
  'bg-primary',
  'bg-secondary',
  'bg-destructive',
  'text-foreground',
  'text-muted-foreground',
  'text-card-foreground',
  'text-popover-foreground',
  'text-primary',
  'text-secondary',
  'text-destructive',
  'border-border',
  'border-input',
];

/**
 * Utility classes from index.css that already handle dark mode
 * (premium-card, metric-card, section-card, entity-card, etc.)
 */
const DARK_SAFE_COMPONENT_CLASSES = [
  'premium-card',
  'metric-card',
  'section-card',
  'entity-card',
  'glass-card',
  'apple-title',
  'apple-description',
  'page-container',
  'empty-state-container',
  'empty-state-icon-box',
  'progress-track',
  'table-header-cell',
  'table-body-cell',
  'label-xs',
];

/* ─── Helpers ─── */

function shouldSkipFile(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Extract all Tailwind class strings from a line of JSX/TSX code.
 * Handles: className="...", className={cn(...)}, className={`...`}, clsx(), etc.
 */
function extractClassStrings(line: string): string[] {
  const results: string[] = [];

  // className="..." or className='...'
  const staticRe = /className=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = staticRe.exec(line)) !== null) {
    results.push(m[1]);
  }

  // cn(...), clsx(...), cva(...) — grab string literal args
  const utilRe = /(?:cn|clsx|cva)\s*\(([^)]*)\)/g;
  while ((m = utilRe.exec(line)) !== null) {
    const inner = m[1];
    // Extract all string literals inside
    const strRe = /['"`]([^'"`]+)['"`]/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(inner)) !== null) {
      results.push(s[1]);
    }
  }

  // Template literals in className={`...`}
  const templateRe = /className=\{`([^`]+)`\}/g;
  while ((m = templateRe.exec(line)) !== null) {
    results.push(m[1]);
  }

  return results;
}

/**
 * Check if a class string contains any dark: variant for a given base pattern.
 */
function hasDarkVariant(allClasses: string, basePrefix: string): boolean {
  // Check for dark:bg-*, dark:text-*, dark:border-* matching the prefix type
  const prefix = basePrefix.split('-')[0]; // 'bg', 'text', 'border'
  return new RegExp(`\\bdark:${prefix}-`).test(allClasses);
}

/**
 * Check if any semantic "safe" class is present that handles dark mode automatically.
 */
function hasSemanticSafeClass(allClasses: string): boolean {
  return SEMANTIC_SAFE_CLASSES.some((cls) => allClasses.includes(cls));
}

/**
 * Check if a dark-mode-safe component class is present.
 */
function hasDarkSafeComponentClass(allClasses: string): boolean {
  return DARK_SAFE_COMPONENT_CLASSES.some((cls) => allClasses.includes(cls));
}

/* ─── Suggestion Map ─── */

const SUGGESTIONS: Record<string, string> = {
  'bg-white': 'Add dark:bg-[hsl(228,14%,10%)] or use bg-card / bg-background',
  'bg-slate-50': 'Add dark:bg-slate-900 or use bg-muted',
  'bg-slate-100': 'Add dark:bg-slate-800 or use bg-accent',
  'bg-gray-50': 'Add dark:bg-gray-900 or use bg-muted',
  'bg-gray-100': 'Add dark:bg-gray-800 or use bg-accent',
  'text-slate-900': 'Add dark:text-slate-100 or use text-foreground',
  'text-slate-800': 'Add dark:text-slate-200 or use text-foreground',
  'text-slate-700': 'Add dark:text-slate-300 or use text-foreground',
  'text-gray-900': 'Add dark:text-gray-100 or use text-foreground',
  'text-gray-800': 'Add dark:text-gray-200 or use text-foreground',
  'text-black': 'Add dark:text-white or use text-foreground',
  'border-slate-200': 'Add dark:border-slate-700 or use border-border',
  'border-slate-100': 'Add dark:border-slate-800 or use border-border',
  'border-white': 'Add dark:border-slate-800',
};

function getSuggestion(cls: string): string {
  if (SUGGESTIONS[cls]) return SUGGESTIONS[cls];
  const prefix = cls.split('-').slice(0, 2).join('-');
  if (prefix === 'bg-white') return SUGGESTIONS['bg-white'];
  if (prefix.startsWith('text-')) return 'Add a dark: text variant or use a semantic token';
  if (prefix.startsWith('border-')) return 'Add a dark: border variant or use border-border';
  return 'Add a matching dark: variant or use a semantic CSS variable';
}

/* ─── Core Audit Logic ─── */

function auditLine(
  line: string,
  lineNumber: number,
  filePath: string
): DarkModeIssue[] {
  const issues: DarkModeIssue[] = [];
  const classStrings = extractClassStrings(line);

  // Combine all class strings on this line for context
  const allClasses = classStrings.join(' ');

  // Skip if line uses semantic safe classes or dark-safe component classes
  if (hasSemanticSafeClass(allClasses) || hasDarkSafeComponentClass(allClasses)) {
    return issues;
  }

  // Skip comment lines
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return issues;
  }

  for (const classStr of classStrings) {
    // 1. bg-white without dark: counterpart
    for (const pattern of LIGHT_BG_NEEDING_DARK) {
      const match = classStr.match(pattern);
      if (match && !hasDarkVariant(classStr, 'bg-')) {
        // Also check if dark: variant might be on the same element via cn() multi-line
        if (!hasDarkVariant(allClasses, 'bg-')) {
          const col = line.indexOf(match[0]);
          issues.push({
            file: filePath,
            line: lineNumber,
            column: col + 1,
            severity: 'error',
            category: 'bg-white-no-dark',
            message: `\`${match[0]}\` without dark mode counterpart`,
            value: match[0],
            suggestion: getSuggestion(match[0]),
          });
        }
      }
    }

    // 2. Light text colors without dark variant
    for (const pattern of LIGHT_TEXT_NEEDING_DARK) {
      const match = classStr.match(pattern);
      if (match && !hasDarkVariant(classStr, 'text-')) {
        if (!hasDarkVariant(allClasses, 'text-')) {
          const col = line.indexOf(match[0]);
          issues.push({
            file: filePath,
            line: lineNumber,
            column: col + 1,
            severity: 'warning',
            category: 'text-color-no-dark',
            message: `\`${match[0]}\` without dark mode counterpart`,
            value: match[0],
            suggestion: getSuggestion(match[0]),
          });
        }
      }
    }

    // 3. Light border colors without dark variant
    for (const pattern of LIGHT_BORDER_NEEDING_DARK) {
      const match = classStr.match(pattern);
      if (match && !hasDarkVariant(classStr, 'border-')) {
        if (!hasDarkVariant(allClasses, 'border-')) {
          const col = line.indexOf(match[0]);
          issues.push({
            file: filePath,
            line: lineNumber,
            column: col + 1,
            severity: 'warning',
            category: 'border-color-no-dark',
            message: `\`${match[0]}\` without dark mode counterpart`,
            value: match[0],
            suggestion: getSuggestion(match[0]),
          });
        }
      }
    }
  }

  // 4. Hard-coded colors in inline styles
  for (const pattern of HARDCODED_COLOR_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const col = line.indexOf(match[0]);
      issues.push({
        file: filePath,
        line: lineNumber,
        column: col + 1,
        severity: 'info',
        category: 'hardcoded-color',
        message: 'Hard-coded color in inline style — may not adapt to dark mode',
        value: match[0].slice(0, 60),
        suggestion: 'Use a CSS variable (e.g., hsl(var(--foreground))) or Tailwind class instead',
      });
    }
  }

  return issues;
}

function auditFile(content: string, filePath: string): FileAuditResult {
  const lines = content.split('\n');
  const issues: DarkModeIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineIssues = auditLine(lines[i], i + 1, filePath);
    issues.push(...lineIssues);
  }

  return {
    file: filePath,
    issueCount: issues.length,
    issues,
  };
}

/* ─── Public API ─── */

/**
 * Run a comprehensive dark mode audit across all provided files.
 *
 * @param files - Map of filePath -> fileContent for all .tsx files to scan
 * @returns A structured report with per-file results and aggregate statistics
 *
 * @example
 * ```ts
 * // In a Vitest test:
 * import { auditDarkMode } from '@/lib/dark-mode-audit';
 * import { globSync } from 'glob';
 * import { readFileSync } from 'fs';
 *
 * const files = new Map<string, string>();
 * for (const f of globSync('src/**\/*.tsx')) {
 *   files.set(f, readFileSync(f, 'utf-8'));
 * }
 * const report = auditDarkMode(files);
 * console.log(`Scanned ${report.filesScanned} files, found ${report.totalIssues} issues`);
 * ```
 */
export function auditDarkMode(
  files: Map<string, string>
): DarkModeAuditReport {
  const results: FileAuditResult[] = [];
  let filesScanned = 0;

  const bySeverity: Record<IssueSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };

  const byCategory: Record<IssueCategory, number> = {
    'missing-dark-variant': 0,
    'hardcoded-color': 0,
    'bg-white-no-dark': 0,
    'text-color-no-dark': 0,
    'border-color-no-dark': 0,
    'inline-style-color': 0,
    'opacity-only-light': 0,
  };

  for (const [filePath, content] of files) {
    if (shouldSkipFile(filePath)) continue;
    filesScanned++;

    const result = auditFile(content, filePath);
    if (result.issueCount > 0) {
      results.push(result);
      for (const issue of result.issues) {
        bySeverity[issue.severity]++;
        byCategory[issue.category]++;
      }
    }
  }

  // Sort by issue count descending
  results.sort((a, b) => b.issueCount - a.issueCount);

  const totalIssues = bySeverity.error + bySeverity.warning + bySeverity.info;

  const summary = results.map((r) => ({
    file: r.file,
    errors: r.issues.filter((i) => i.severity === 'error').length,
    warnings: r.issues.filter((i) => i.severity === 'warning').length,
    info: r.issues.filter((i) => i.severity === 'info').length,
    total: r.issueCount,
  }));

  return {
    timestamp: new Date().toISOString(),
    filesScanned,
    filesWithIssues: results.length,
    totalIssues,
    bySeverity,
    byCategory,
    results,
    summary,
  };
}

/**
 * Audit a single file's content for dark mode issues.
 * Useful for incremental checks (e.g., in a pre-commit hook or editor plugin).
 */
export function auditSingleFile(
  content: string,
  filePath: string
): FileAuditResult {
  if (shouldSkipFile(filePath)) {
    return { file: filePath, issueCount: 0, issues: [] };
  }
  return auditFile(content, filePath);
}

/**
 * Format an audit report as a human-readable string for CLI output.
 */
export function formatReport(report: DarkModeAuditReport): string {
  const lines: string[] = [];

  lines.push('='.repeat(70));
  lines.push('  DARK MODE AUDIT REPORT');
  lines.push(`  Generated: ${report.timestamp}`);
  lines.push('='.repeat(70));
  lines.push('');
  lines.push(`  Files scanned:      ${report.filesScanned}`);
  lines.push(`  Files with issues:  ${report.filesWithIssues}`);
  lines.push(`  Total issues:       ${report.totalIssues}`);
  lines.push('');
  lines.push('  By Severity:');
  lines.push(`    Errors:    ${report.bySeverity.error}`);
  lines.push(`    Warnings:  ${report.bySeverity.warning}`);
  lines.push(`    Info:      ${report.bySeverity.info}`);
  lines.push('');
  lines.push('  By Category:');
  for (const [cat, count] of Object.entries(report.byCategory)) {
    if (count > 0) {
      lines.push(`    ${cat}: ${count}`);
    }
  }
  lines.push('');

  if (report.results.length === 0) {
    lines.push('  All components are dark-mode compliant!');
  } else {
    lines.push('-'.repeat(70));
    lines.push('  ISSUES BY FILE (sorted by count)');
    lines.push('-'.repeat(70));

    for (const result of report.results) {
      lines.push('');
      lines.push(`  ${result.file} (${result.issueCount} issue${result.issueCount !== 1 ? 's' : ''})`);
      for (const issue of result.issues) {
        const sev = issue.severity === 'error' ? 'ERR' : issue.severity === 'warning' ? 'WRN' : 'INF';
        lines.push(`    [${sev}] L${issue.line}:${issue.column} ${issue.message}`);
        lines.push(`          Fix: ${issue.suggestion}`);
      }
    }
  }

  lines.push('');
  lines.push('='.repeat(70));
  return lines.join('\n');
}
