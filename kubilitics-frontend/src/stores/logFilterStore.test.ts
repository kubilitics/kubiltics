import { describe, it, expect, beforeEach } from 'vitest';
import { useLogFilterStore } from './logFilterStore';

describe('logFilterStore', () => {
  beforeEach(() => {
    useLogFilterStore.setState(useLogFilterStore.getInitialState());
  });

  it('has correct default state', () => {
    const state = useLogFilterStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.levelFilter).toBe('all');
    expect(state.regexMode).toBe(false);
    expect(state.inverseFilter).toBe(false);
    expect(state.contextLines).toBe(0);
    expect(state.prettifyJson).toBe(true);
    expect(state.hideTerminated).toBe(false);
  });

  it('updates search query', () => {
    useLogFilterStore.getState().setSearchQuery('error');
    expect(useLogFilterStore.getState().searchQuery).toBe('error');
  });

  it('updates level filter', () => {
    useLogFilterStore.getState().setLevelFilter('error');
    expect(useLogFilterStore.getState().levelFilter).toBe('error');
  });

  it('toggles regex mode', () => {
    useLogFilterStore.getState().toggleRegexMode();
    expect(useLogFilterStore.getState().regexMode).toBe(true);
    useLogFilterStore.getState().toggleRegexMode();
    expect(useLogFilterStore.getState().regexMode).toBe(false);
  });

  it('toggles inverse filter', () => {
    useLogFilterStore.getState().toggleInverseFilter();
    expect(useLogFilterStore.getState().inverseFilter).toBe(true);
  });

  it('sets context lines', () => {
    useLogFilterStore.getState().setContextLines(3);
    expect(useLogFilterStore.getState().contextLines).toBe(3);
  });

  it('resets all filters', () => {
    const s = useLogFilterStore.getState();
    s.setSearchQuery('test');
    s.setLevelFilter('error');
    s.toggleRegexMode();
    useLogFilterStore.getState().resetFilters();
    const after = useLogFilterStore.getState();
    expect(after.searchQuery).toBe('');
    expect(after.levelFilter).toBe('all');
    expect(after.regexMode).toBe(false);
  });
});
