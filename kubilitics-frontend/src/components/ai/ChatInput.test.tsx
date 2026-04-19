import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';

describe('ChatInput', () => {
  it('calls onSend with text on submit', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={() => {}} disabled={false} streaming={false} />);
    const ta = screen.getByPlaceholderText(/ask/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('Shift+Enter inserts newline (no send)', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={() => {}} disabled={false} streaming={false} />);
    const ta = screen.getByPlaceholderText(/ask/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disabled prevents input + shows custom placeholder', () => {
    render(
      <ChatInput
        onSend={() => {}} onStop={() => {}}
        disabled={true} streaming={false}
        disabledPlaceholder="Session expired — start a new chat"
      />
    );
    const ta = screen.getByPlaceholderText(/Session expired/) as HTMLTextAreaElement;
    expect(ta).toBeDisabled();
  });

  it('streaming shows Stop button calling onStop', () => {
    const onStop = vi.fn();
    render(<ChatInput onSend={() => {}} onStop={onStop} disabled={false} streaming={true} />);
    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
