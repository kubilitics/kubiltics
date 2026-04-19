import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AskAIButton } from './AskAIButton';
import { useChatStore } from '@/stores/chatStore';
import { useAIContextStore } from '@/stores/aiContextStore';

describe('AskAIButton', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getState().__resetForTests(), true);
    useAIContextStore.setState({ implicit: null, explicit: null }, false);
  });

  it('opens panel + sets explicit context + sets prefill on click', () => {
    render(
      <AskAIButton
        context={{ type: 'pod', cluster: 'c1', namespace: 'default', name: 'p1' }}
        promptTemplate="Why is this pod CrashLoopBackOff?"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /ask ai/i }));
    expect(useChatStore.getState().panelOpen).toBe(true);
    expect(useAIContextStore.getState().explicit?.name).toBe('p1');
    expect(useChatStore.getState().prefilledText).toBe('Why is this pod CrashLoopBackOff?');
  });
});
