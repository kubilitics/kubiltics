import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextBlock } from './TextBlock';

describe('TextBlock', () => {
  it('renders plain text', () => {
    render(<TextBlock content="hello world" complete={true} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders code blocks via markdown', () => {
    render(<TextBlock content={'```\nkubectl get pods\n```'} complete={true} />);
    expect(screen.getByText(/kubectl get pods/)).toBeInTheDocument();
  });

  it('shows streaming cursor when not complete', () => {
    const { container } = render(<TextBlock content="streaming" complete={false} />);
    expect(container.querySelector('[data-streaming-cursor="true"]')).toBeInTheDocument();
  });

  it('hides streaming cursor when complete', () => {
    const { container } = render(<TextBlock content="done" complete={true} />);
    expect(container.querySelector('[data-streaming-cursor="true"]')).not.toBeInTheDocument();
  });
});
