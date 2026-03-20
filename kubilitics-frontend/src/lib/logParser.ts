/**
 * Shared log parsing for LogViewer and ResourceComparisonView.
 * Parses raw log text into structured entries with level detection for highlighting.
 */
export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  raw?: string;
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
    };
  }

  return {
    timestamp: new Date().toISOString(),
    level: detectLevel(trimmed),
    message: trimmed,
    raw: line,
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
