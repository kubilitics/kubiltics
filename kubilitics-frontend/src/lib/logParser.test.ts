import { describe, it, expect } from 'vitest';
import { parseLogLine, parseRawLogs, detectLevel } from './logParser';

describe('logParser JSON detection', () => {
  it('detects JSON object in log message', () => {
    const entry = parseLogLine('2024-01-01T00:00:00Z {"key":"value","num":42}');
    expect(entry.isJson).toBe(true);
    expect(entry.jsonData).toEqual({ key: 'value', num: 42 });
  });

  it('detects JSON array in log message', () => {
    const entry = parseLogLine('2024-01-01T00:00:00Z [1,2,3]');
    expect(entry.isJson).toBe(true);
    expect(entry.jsonData).toEqual([1, 2, 3]);
  });

  it('does not flag plain text as JSON', () => {
    const entry = parseLogLine('2024-01-01T00:00:00Z Starting server on port 8080');
    expect(entry.isJson).toBeFalsy();
    expect(entry.jsonData).toBeUndefined();
  });

  it('does not flag invalid JSON as JSON', () => {
    const entry = parseLogLine('2024-01-01T00:00:00Z {broken json');
    expect(entry.isJson).toBe(false);
  });

  it('detects JSON in bracket-timestamp format', () => {
    const entry = parseLogLine('[2024-01-01 00:00:00] {"event":"startup"}');
    expect(entry.isJson).toBe(true);
    expect(entry.jsonData).toEqual({ event: 'startup' });
  });

  it('detects JSON in raw line without timestamp', () => {
    const entry = parseLogLine('{"level":"info","msg":"hello"}');
    expect(entry.isJson).toBe(true);
    expect(entry.jsonData).toEqual({ level: 'info', msg: 'hello' });
  });

  it('parseRawLogs preserves JSON detection across lines', () => {
    const logs = '2024-01-01T00:00:00Z {"a":1}\n2024-01-01T00:00:01Z plain text';
    const entries = parseRawLogs(logs);
    expect(entries[0].isJson).toBe(true);
    expect(entries[1].isJson).toBeFalsy();
  });
});

// Existing behavior tests (should still pass)
describe('logParser existing behavior', () => {
  it('parses ISO timestamp', () => {
    const entry = parseLogLine('2024-01-01T12:00:00Z some message');
    expect(entry.timestamp).toBe('2024-01-01T12:00:00Z');
    expect(entry.message).toBe('some message');
  });

  it('detects error level', () => {
    expect(detectLevel('ERROR: something failed')).toBe('error');
    expect(detectLevel('fatal crash')).toBe('error');
  });

  it('detects warn level', () => {
    expect(detectLevel('WARNING: disk space low')).toBe('warn');
  });

  it('detects debug level', () => {
    expect(detectLevel('DEBUG: variable x = 5')).toBe('debug');
  });

  it('defaults to info level', () => {
    expect(detectLevel('Starting server')).toBe('info');
  });

  it('handles empty line', () => {
    const entry = parseLogLine('');
    expect(entry.message).toBe('');
  });

  it('parseRawLogs splits and filters', () => {
    const entries = parseRawLogs('line1\n\nline2');
    expect(entries).toHaveLength(2);
  });
});
