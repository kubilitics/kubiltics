import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLogFilterHistory } from './useLogFilterHistory';

describe('useLogFilterHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty history', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    expect(result.current.history).toEqual([]);
  });

  it('adds a filter to history', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    act(() => result.current.addFilter('error'));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].query).toBe('error');
    expect(result.current.history[0].pinned).toBe(false);
  });

  it('does not add duplicate filters', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    act(() => result.current.addFilter('error'));
    act(() => result.current.addFilter('error'));
    expect(result.current.history).toHaveLength(1);
  });

  it('pins a filter', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    act(() => result.current.addFilter('error'));
    act(() => result.current.togglePin('error'));
    expect(result.current.history[0].pinned).toBe(true);
  });

  it('removes a filter', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    act(() => result.current.addFilter('error'));
    act(() => result.current.removeFilter('error'));
    expect(result.current.history).toHaveLength(0);
  });

  it('limits history to 20 items', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    for (let i = 0; i < 25; i++) {
      act(() => result.current.addFilter(`filter-${i}`));
    }
    expect(result.current.history.length).toBeLessThanOrEqual(20);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useLogFilterHistory());
    act(() => result.current.addFilter('persistent'));
    const stored = JSON.parse(localStorage.getItem('kubilitics:log-filter-history') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe('persistent');
  });
});
