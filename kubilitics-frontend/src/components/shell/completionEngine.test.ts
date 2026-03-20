import { describe, expect, it } from 'vitest';
import { applyCompletionToLine, updateLineBuffer } from './completionEngine';

describe('completionEngine', () => {
  describe('applyCompletionToLine', () => {
    it('appends suffix when completion extends current token', () => {
      const out = applyCompletionToLine('kubectl get po', 'pods');
      expect(out).toEqual({
        payload: 'ds ',
        nextLine: 'kubectl get pods ',
      });
    });

    it('replaces token when completion does not share prefix', () => {
      const out = applyCompletionToLine('kubectl get xyz', 'pods');
      expect(out).toEqual({
        payload: '\u007f\u007f\u007fpods ',
        nextLine: 'kubectl get pods ',
      });
    });

    it('adds completion after trailing space', () => {
      const out = applyCompletionToLine('kubectl get ', 'pods');
      expect(out).toEqual({
        payload: 'pods ',
        nextLine: 'kubectl get pods ',
      });
    });
  });

  describe('updateLineBuffer', () => {
    it('adds printable characters', () => {
      expect(updateLineBuffer('', 'kubectl')).toBe('kubectl');
    });

    it('ignores ANSI escape sequences', () => {
      expect(updateLineBuffer('kubectl get po', '\u001b[A')).toBe('kubectl get po');
    });

    it('handles backspace', () => {
      expect(updateLineBuffer('pods', '\u007f')).toBe('pod');
    });

    it('handles Ctrl+W delete previous word', () => {
      expect(updateLineBuffer('kubectl get pods', '\u0017')).toBe('kubectl get');
    });

    it('handles Ctrl+U clear line', () => {
      expect(updateLineBuffer('kubectl get pods', '\u0015')).toBe('');
    });

    it('handles Enter by resetting line', () => {
      expect(updateLineBuffer('kubectl get pods', '\r')).toBe('');
    });
  });
});

