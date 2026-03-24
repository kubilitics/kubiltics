import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearchHistory } from './useSearchHistory';

describe('useSearchHistory', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    const { result } = renderHook(() => useSearchHistory());
    expect(result.current.history).toEqual([]);
  });

  it('adds a search', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('nginx'));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].query).toBe('nginx');
  });

  it('deduplicates', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('nginx'));
    act(() => result.current.addSearch('nginx'));
    expect(result.current.history).toHaveLength(1);
  });

  it('limits to 15 items', () => {
    const { result } = renderHook(() => useSearchHistory());
    for (let i = 0; i < 20; i++) act(() => result.current.addSearch(`q-${i}`));
    expect(result.current.history.length).toBeLessThanOrEqual(15);
  });

  it('removes a search', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('nginx'));
    act(() => result.current.removeSearch('nginx'));
    expect(result.current.history).toHaveLength(0);
  });

  it('clears all', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('a'));
    act(() => result.current.addSearch('b'));
    act(() => result.current.clearHistory());
    expect(result.current.history).toHaveLength(0);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('persistent'));
    expect(JSON.parse(localStorage.getItem('kubilitics:search-history') ?? '[]')).toHaveLength(1);
  });

  it('stores resultType when provided', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('nginx', 'pod'));
    expect(result.current.history[0].resultType).toBe('pod');
  });

  it('ignores blank queries', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch(''));
    act(() => result.current.addSearch('   '));
    expect(result.current.history).toHaveLength(0);
  });

  it('moves duplicate to top on re-add', () => {
    const { result } = renderHook(() => useSearchHistory());
    act(() => result.current.addSearch('alpha'));
    act(() => result.current.addSearch('beta'));
    act(() => result.current.addSearch('alpha'));
    expect(result.current.history[0].query).toBe('alpha');
    expect(result.current.history[1].query).toBe('beta');
    expect(result.current.history).toHaveLength(2);
  });
});
