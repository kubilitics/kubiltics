import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Turn } from './Turn';

describe('Turn', () => {
  it('renders TextBlock for text blocks', () => {
    render(
      <Turn
        turn={{
          turnId: 't', anchorId: 'a', startedAt: 0, state: 'done',
          blocks: [{ type: 'text', content: 'hi', complete: true }],
        }}
      />
    );
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('renders UnknownBlock for unknown types', () => {
    render(
      <Turn
        turn={{
          turnId: 't', anchorId: 'a', startedAt: 0, state: 'done',
          blocks: [{ type: 'unknown', kind: 'plan_proposed', raw: {} }],
        }}
      />
    );
    expect(screen.getByText(/plan proposed/)).toBeInTheDocument();
  });

  it('historical state applies opacity class', () => {
    const { container } = render(
      <Turn
        turn={{
          turnId: 't', anchorId: 'a', startedAt: 0, state: 'historical',
          blocks: [{ type: 'text', content: 'old', complete: true }],
        }}
      />
    );
    expect(container.firstChild).toHaveClass('opacity-60');
  });

  it('error state shows error message', () => {
    render(
      <Turn
        turn={{
          turnId: 't', anchorId: 'a', startedAt: 0, state: 'error',
          blocks: [],
          error: { code: 'Internal', message: 'boom' },
        }}
      />
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
