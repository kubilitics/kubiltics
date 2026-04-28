import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LogBlock } from './LogBlock';
import type { LogBlockData } from './render-types';

const baseData = (over: Partial<LogBlockData> = {}): LogBlockData => ({
  pod: 'app-1',
  container: 'main',
  namespace: 'prod',
  lines: ['line one', 'line two', 'line three'],
  truncated: false,
  total: 3,
  ...over,
});

describe('LogBlock', () => {
  it('renders header with pod / container', () => {
    render(<LogBlock data={baseData()} />);
    expect(screen.getByText(/Logs · app-1 \/ main/)).toBeInTheDocument();
  });

  it('renders header with pod only when container is empty', () => {
    render(<LogBlock data={baseData({ container: '' })} />);
    expect(screen.getByText(/Logs · app-1$/)).toBeInTheDocument();
  });

  it('renders all log lines verbatim', () => {
    render(<LogBlock data={baseData()} />);
    expect(screen.getByText('line one')).toBeInTheDocument();
    expect(screen.getByText('line two')).toBeInTheDocument();
    expect(screen.getByText('line three')).toBeInTheDocument();
  });

  it('renders empty state when no lines', () => {
    render(<LogBlock data={baseData({ lines: [], total: 0 })} />);
    expect(screen.getByText(/No log lines in the requested window/i)).toBeInTheDocument();
  });

  it('disables Copy when no lines', () => {
    render(<LogBlock data={baseData({ lines: [], total: 0 })} />);
    const copy = screen.getByRole('button', { name: /copy all log lines/i });
    expect(copy).toBeDisabled();
  });

  it('shows truncation banner when shaper elided lines', () => {
    render(<LogBlock data={baseData({ truncated: true, total: 1500 })} />);
    expect(screen.getByText(/Earlier lines elided/i)).toBeInTheDocument();
    expect(screen.getByText(/showing last 3 of 1,500 lines/i)).toBeInTheDocument();
  });

  it('does NOT show truncation banner for full output', () => {
    render(<LogBlock data={baseData()} />);
    expect(screen.queryByText(/Earlier lines elided/i)).toBeNull();
  });

  it('copy button writes joined log content', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LogBlock data={baseData()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy all log lines/i }));
    expect(writeText).toHaveBeenCalledWith('line one\nline two\nline three');
  });

  it('toggles line numbers visibility', () => {
    render(<LogBlock data={baseData()} />);
    // Default: line numbers ON → toggle reads "# off"
    const toggle = screen.getByRole('button', { name: /hide line numbers/i });
    expect(toggle).toHaveTextContent('# off');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /show line numbers/i })).toHaveTextContent('# on');
  });

  it('renders with line numbers offset by truncation', () => {
    // When the shaper truncated 1500 → 3 lines (kept the tail), line
    // numbers should read 1498/1499/1500, not 1/2/3 — so the SRE knows
    // they're looking at the end of the log.
    render(<LogBlock data={baseData({ truncated: true, total: 1500 })} />);
    expect(screen.getByText('1498')).toBeInTheDocument();
    expect(screen.getByText('1499')).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
  });

  it('renders simple 1-based line numbers when not truncated', () => {
    render(<LogBlock data={baseData()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('falls back to "Pod logs" title when pod is unknown', () => {
    render(<LogBlock data={baseData({ pod: '', container: '' })} />);
    expect(screen.getByText(/Pod logs/)).toBeInTheDocument();
  });
});
