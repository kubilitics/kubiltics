/**
 * Shared log parsing for LogViewer and ResourceComparisonView.
 * Parses raw log text into structured entries with level detection for highlighting.
 */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  raw?: string;
  isJson?: boolean;
  jsonData?: unknown;
}

export function detectLevel(message: string): 'info' | 'warn' | 'error' | 'debug' {
  const lower = message.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic') || lower.includes('exception')) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  return 'info';
}

function tryParseJson(text: string): { isJson: boolean; jsonData?: unknown } {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { isJson: true, jsonData: JSON.parse(trimmed) };
    } catch {
      return { isJson: false };
    }
  }
  return { isJson: false };
}

export function parseLogLine(line: string): LogEntry {
  const trimmed = line.trim();
  if (!trimmed) {
    return { timestamp: '', level: 'info', message: '', raw: line };
  }

  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+(.*)$/);
  if (isoMatch) {
    const [, timestamp, rest] = isoMatch;
    return {
      timestamp: timestamp || '',
      level: detectLevel(rest),
      message: rest,
      raw: line,
      ...tryParseJson(rest),
    };
  }

  const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracketMatch) {
    const [, timestamp, rest] = bracketMatch;
    return {
      timestamp: timestamp || '',
      level: detectLevel(rest),
      message: rest,
      raw: line,
      ...tryParseJson(rest),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    level: detectLevel(trimmed),
    message: trimmed,
    raw: line,
    ...tryParseJson(trimmed),
  };
}

export function parseRawLogs(rawLogs: string): LogEntry[] {
  if (!rawLogs) return [];
  return rawLogs
    .split('\n')
    .filter(line => line.trim())
    .map(parseLogLine);
}

export const levelColors: Record<string, string> = {
  info: 'text-[hsl(var(--info))]',
  warn: 'text-[hsl(var(--warning))]',
  error: 'text-[hsl(var(--error))]',
  debug: 'text-muted-foreground',
};
