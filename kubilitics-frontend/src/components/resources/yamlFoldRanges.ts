/**
 * Locate the 1-indexed line range of a dot-path in a serialized YAML string,
 * without a full parse. Uses a simple indentation walker so it is safe to
 * call on every keystroke.
 *
 *   findFoldRange(yaml, 'status')
 *   findFoldRange(yaml, 'metadata.managedFields')
 *   findFoldRange(yaml, 'spec.template')
 *
 * Returns { startLine, endLine } (both 1-indexed, inclusive) or null if the
 * path is not present at the expected nesting depth.
 */
export interface FoldRange {
  startLine: number;
  endLine: number;
}

export function findFoldRange(yaml: string, dotPath: string): FoldRange | null {
  if (!yaml || !dotPath) return null;

  const segments = dotPath.split('.').filter(Boolean);
  if (segments.length === 0) return null;

  const lines = yaml.split('\n');
  let searchFrom = 0;
  let parentIndent = -1; // first segment must start at column 0
  let matchLine = -1;
  let matchIndent = -1;

  for (const segment of segments) {
    const hit = findKeyLine(lines, segment, searchFrom, parentIndent);
    if (hit === -1) return null;
    matchLine = hit;
    matchIndent = indentOf(lines[hit]);
    // Next segment must appear AFTER this line and at a deeper indent.
    searchFrom = hit + 1;
    parentIndent = matchIndent;
  }

  // Walk forward from the matched line until we drop back to indent <= match.
  const endLine = walkEnd(lines, matchLine, matchIndent);
  return { startLine: matchLine + 1, endLine: endLine + 1 }; // 1-indexed
}

/** Index of the first line that starts with `<indent><key>:` where indent matches the parent level + more. */
function findKeyLine(
  lines: string[],
  key: string,
  from: number,
  parentIndent: number,
): number {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (parentIndent < 0) {
      // Top-level: require indent === 0
      if (ind !== 0) continue;
    } else {
      // Nested: require indent > parentIndent, AND if we drop back to <= parent we must stop (key not found in this subtree)
      if (ind <= parentIndent) return -1;
    }
    // Match `<spaces><key>:` exactly — use a boundary so 'status' does not match 'statuses:'.
    const stripped = line.slice(ind);
    if (stripped === `${key}:` || stripped.startsWith(`${key}: `) || stripped.startsWith(`${key}:\t`)) {
      return i;
    }
  }
  return -1;
}

/** Returns the 0-indexed last line belonging to a block whose key is at `blockIndent`. */
function walkEnd(lines: string[], startLine: number, blockIndent: number): number {
  let lastContentLine = startLine;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (ind <= blockIndent) {
      return lastContentLine;
    }
    lastContentLine = i;
  }
  return lastContentLine;
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}
