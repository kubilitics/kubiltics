import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YamlBlock } from './YamlBlock';

describe('YamlBlock', () => {
  it('renders yaml verbatim with whitespace preserved', () => {
    render(<YamlBlock data={{ yaml: 'kind: Pod\n  whitespace:    preserved' }} />);
    // Testing-library normalizes whitespace by default; assert via a node
    // matcher that checks the raw textContent of the <code> element.
    const code = screen.getByText((_, el) =>
      el?.tagName === 'CODE' && el.textContent === 'kind: Pod\n  whitespace:    preserved',
    );
    expect(code).toBeInTheDocument();
  });

  it('copy button writes raw yaml to clipboard', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<YamlBlock data={{ yaml: 'kind: Pod\nname: x' }} />);
    fireEvent.click(screen.getByRole('button', { name: /copy yaml/i }));
    expect(writeText).toHaveBeenCalledWith('kind: Pod\nname: x');
  });
});
