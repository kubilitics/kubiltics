import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KubectlTableBlock } from './KubectlTableBlock';

describe('KubectlTableBlock', () => {
  const data = {
    columns: [
      { key: 'NAME', label: 'NAME' },
      { key: 'STATUS', label: 'STATUS' },
      { key: 'RESTARTS', label: 'RESTARTS', align: 'right' as const },
    ],
    rows: [
      { NAME: 'coredns-1', STATUS: 'Running', RESTARTS: 0 },
      { NAME: 'kube-proxy-1', STATUS: 'Pending', RESTARTS: 2 },
    ],
  };

  it('renders columns and rows', () => {
    render(<KubectlTableBlock data={data} />);
    expect(screen.getByText('coredns-1')).toBeInTheDocument();
    expect(screen.getByText('kube-proxy-1')).toBeInTheDocument();
    expect(screen.getByText('NAME')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows empty state when rows is empty', () => {
    render(<KubectlTableBlock data={{ columns: data.columns, rows: [] }} />);
    expect(screen.getByText(/no resources/i)).toBeInTheDocument();
  });
});
