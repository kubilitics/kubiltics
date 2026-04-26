import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('./useAIProfiles', () => ({
  useAIProfiles: vi.fn(),
}));

import { useAIProfiles } from './useAIProfiles';
import { useActiveProfile } from './useActiveProfile';

const PROFILE = {
  id: 'a',
  name: 'OpenAI',
  provider: 'openai',
  model: 'gpt-4o',
  base_url: '',
  has_key: true,
  created_at: '2026-04-26T00:00:00Z',
  updated_at: '2026-04-26T00:00:00Z',
  last_validated_at: null,
  last_error: null,
};

describe('useActiveProfile', () => {
  it('returns null when no profiles', () => {
    vi.mocked(useAIProfiles).mockReturnValue({
      profiles: [], activeId: null, isLoading: false, reload: async () => {},
    });
    const { result } = renderHook(() => useActiveProfile());
    expect(result.current).toBeNull();
  });

  it('returns null when activeId not in list', () => {
    vi.mocked(useAIProfiles).mockReturnValue({
      profiles: [PROFILE], activeId: 'nonexistent', isLoading: false, reload: async () => {},
    });
    const { result } = renderHook(() => useActiveProfile());
    expect(result.current).toBeNull();
  });

  it('returns the matching profile', () => {
    vi.mocked(useAIProfiles).mockReturnValue({
      profiles: [PROFILE], activeId: 'a', isLoading: false, reload: async () => {},
    });
    const { result } = renderHook(() => useActiveProfile());
    expect(result.current?.id).toBe('a');
  });
});
