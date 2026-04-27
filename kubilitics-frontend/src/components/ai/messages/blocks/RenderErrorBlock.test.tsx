import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenderErrorBlock } from './RenderErrorBlock';

describe('RenderErrorBlock', () => {
  it('renders tool name, error, and raw payload', () => {
    render(
      <RenderErrorBlock
        data={{ tool: 'list_pods', error: 'shaper: invalid json', raw: 'something raw' }}
      />,
    );
    expect(screen.getByText(/list_pods/)).toBeInTheDocument();
    expect(screen.getByText(/shaper: invalid json/)).toBeInTheDocument();
    expect(screen.getByText(/something raw/)).toBeInTheDocument();
  });

  it('shows truncation notice for ...[truncated] suffix', () => {
    render(
      <RenderErrorBlock data={{ tool: 'x', error: 'big', raw: 'AAA...[truncated]' }} />,
    );
    expect(screen.getByText(/truncated at 200 KB/i)).toBeInTheDocument();
  });
});
