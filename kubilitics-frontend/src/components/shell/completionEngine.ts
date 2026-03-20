export interface CompletionApplyResult {
  payload: string;
  nextLine: string;
}

export function applyCompletionToLine(line: string, completion: string): CompletionApplyResult | null {
  const trimmed = completion.trim();
  if (!trimmed) return null;

  const endsWithSpace = line.length > 0 && /\s$/.test(line);
  const tokenMatch = line.match(/(\S+)$/);
  const token = endsWithSpace ? '' : (tokenMatch?.[1] ?? '');
  let payload = '';
  let nextLine = line;

  if (token && trimmed.startsWith(token)) {
    payload = trimmed.slice(token.length) + ' ';
    nextLine = line.slice(0, line.length - token.length) + trimmed + ' ';
  } else if (token) {
    payload = '\u007f'.repeat([...token].length) + trimmed + ' ';
    nextLine = line.slice(0, line.length - token.length) + trimmed + ' ';
  } else {
    payload = trimmed + ' ';
    nextLine = line + payload;
  }

  return { payload, nextLine };
}

export function updateLineBuffer(current: string, data: string): string {
  // Ignore ANSI escape/control sequences (arrow keys, Home/End, etc.) for local completion buffer.
  if (data.includes('\u001b')) {
    return current;
  }

  let next = current;
  for (const ch of data) {
    if (ch === '\r' || ch === '\n' || ch === '\u0003') {
      next = '';
      continue;
    }
    if (ch === '\u007f') { // Backspace
      const chars = [...next];
      chars.pop();
      next = chars.join('');
      continue;
    }
    if (ch === '\u0015') { // Ctrl+U clears line
      next = '';
      continue;
    }
    if (ch === '\u0017') { // Ctrl+W deletes previous word
      next = next.replace(/\s*\S+\s*$/, '');
      continue;
    }
    if (ch < ' ') {
      continue;
    }
    next += ch;
    if (next.length > 2048) {
      next = next.slice(-2048);
    }
  }
  return next;
}

