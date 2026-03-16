/**
 * Dark Mode Variable Enforcement
 *
 * TASK-UX-013: Ban direct `dark:bg-*` classes; enforce semantic tokens.
 *
 * Usage: Import and run `auditDarkModeClasses` in tests to catch violations.
 * Can also be used as a custom ESLint rule plugin.
 */

/**
 * Banned direct dark mode background classes.
 * Use semantic tokens instead:
 *   - dark:bg-white → bg-card
 *   - dark:bg-gray-900 → bg-background
 *   - dark:bg-gray-800 → bg-card or bg-popover
 */
const BANNED_PATTERNS = [
  // Direct hex/color dark backgrounds (use bg-card, bg-background, bg-popover instead)
  /dark:bg-(white|black|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900|950)/,
  // Direct dark text colors that should use semantic tokens
  /dark:text-(white|black|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900|950)/,
  // Direct dark border colors that should use semantic tokens
  /dark:border-(white|black|gray|slate|zinc|neutral|stone)-(50|100|200|300|400|500|600|700|800|900|950)/,
];

/**
 * Allowed exceptions — some components legitimately need direct dark: classes
 * for specific visual effects (gradients, overlays, hover states on colored elements).
 */
const ALLOWED_EXCEPTIONS = [
  // Status colors are intentional
  /dark:(bg|text|border)-(red|green|blue|amber|emerald|cyan|violet|purple|indigo|orange|yellow|pink|rose|teal|sky|lime|fuchsia)/,
  // Opacity modifiers are fine
  /dark:(bg|text|border)-\w+\/\d+/,
  // Ring colors
  /dark:ring-/,
  // Hover/focus states on colored elements
  /dark:hover:/,
  /dark:focus:/,
  /dark:group-hover:/,
];

export interface DarkModeViolation {
  file: string;
  line: number;
  column: number;
  className: string;
  suggestion: string;
}

/**
 * Map of banned patterns to suggested replacements
 */
const SUGGESTIONS: Record<string, string> = {
  'dark:bg-white': 'bg-card or bg-background',
  'dark:bg-black': 'bg-background',
  'dark:bg-slate-900': 'bg-background',
  'dark:bg-slate-800': 'bg-card',
  'dark:bg-slate-700': 'bg-muted or bg-accent',
  'dark:bg-gray-900': 'bg-background',
  'dark:bg-gray-800': 'bg-card',
  'dark:text-white': 'text-foreground',
  'dark:text-slate-100': 'text-foreground',
  'dark:text-slate-200': 'text-foreground',
  'dark:text-slate-300': 'text-muted-foreground',
  'dark:text-slate-400': 'text-muted-foreground',
  'dark:border-slate-700': 'border-border',
  'dark:border-slate-800': 'border-border',
};

/**
 * Check if a class name violates dark mode enforcement rules.
 */
export function isDarkModeViolation(className: string): boolean {
  // Check if it matches any banned pattern
  const isBanned = BANNED_PATTERNS.some((pattern) => pattern.test(className));
  if (!isBanned) return false;

  // Check if it's an allowed exception
  const isAllowed = ALLOWED_EXCEPTIONS.some((pattern) => pattern.test(className));
  return !isAllowed;
}

/**
 * Get suggestion for a banned class
 */
export function getSuggestion(className: string): string {
  // Check exact match first
  if (SUGGESTIONS[className]) return `Use ${SUGGESTIONS[className]} instead`;

  // Check prefix match
  for (const [pattern, suggestion] of Object.entries(SUGGESTIONS)) {
    if (className.startsWith(pattern.split('-').slice(0, 2).join('-'))) {
      return `Use ${suggestion} instead`;
    }
  }

  return 'Use a semantic CSS variable (bg-card, bg-background, text-foreground, etc.)';
}

/**
 * Audit a source file content for dark mode violations.
 * Returns an array of violations found.
 */
export function auditDarkModeClasses(
  content: string,
  filePath: string
): DarkModeViolation[] {
  const violations: DarkModeViolation[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Extract class names from className strings, cn() calls, etc.
    const classRegex = /(?:dark:(?:bg|text|border)-[\w/-]+)/g;
    let match;

    while ((match = classRegex.exec(line)) !== null) {
      const className = match[0];
      if (isDarkModeViolation(className)) {
        violations.push({
          file: filePath,
          line: lineIdx + 1,
          column: match.index + 1,
          className,
          suggestion: getSuggestion(className),
        });
      }
    }
  }

  return violations;
}
