import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenderBlock } from './RenderBlock';

describe('RenderBlock dispatcher', () => {
  it('dispatches kubectl_table to KubectlTableBlock', () => {
    render(
      <RenderBlock
        renderType="kubectl_table"
        data={{
          columns: [
            { key: 'NAME', label: 'NAME' },
            { key: 'STATUS', label: 'STATUS' },
          ],
          rows: [
            { NAME: 'coredns-1', STATUS: 'Running' },
            { NAME: 'kube-proxy-1', STATUS: 'Pending' },
          ],
        }}
        summary="2 pods (1 Running, 1 Pending)"
      />,
    );
    expect(screen.getByText('coredns-1')).toBeInTheDocument();
    expect(screen.getByText('kube-proxy-1')).toBeInTheDocument();
    expect(screen.getByTestId('render-summary')).toHaveTextContent(
      '2 pods (1 Running, 1 Pending)',
    );
  });

  it('dispatches yaml_block to YamlBlock with verbatim content', () => {
    render(
      <RenderBlock renderType="yaml_block" data={{ yaml: 'kind: Pod\n  preserved:    spaces' }} />,
    );
    const code = screen.getByText((_, el) =>
      el?.tagName === 'CODE' && el.textContent === 'kind: Pod\n  preserved:    spaces',
    );
    expect(code).toBeInTheDocument();
  });

  it('falls back to RenderErrorBlock for unknown render types', () => {
    render(<RenderBlock renderType="future_unknown_type" data={{}} />);
    expect(screen.getByText(/Unknown render type/i)).toBeInTheDocument();
  });

  it('renders render_error type', () => {
    render(
      <RenderBlock
        renderType="render_error"
        data={{ tool: 'list_pods', error: 'shaper failed', raw: 'oops' }}
      />,
    );
    expect(screen.getByText(/list_pods/)).toBeInTheDocument();
    expect(screen.getByText(/shaper failed/)).toBeInTheDocument();
  });
});
