import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { EventRow } from './EventRow';

const now = Date.now();

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'e1',
    cluster_id: 'cluster-1',
    reason: 'BackOff',
    message:
      'Back-off restarting failed container busybox in pod default/wrong-container-command-pod',
    event_type: 'Warning',
    event_count: 7,
    timestamp: now - 60000,
    last_seen: now - 60000,
    first_seen: now - 120000,
    source_component: 'kubelet',
    source_host: '',
    resource_kind: 'Pod',
    resource_name: 'wrong-container-command-pod',
    resource_namespace: 'default',
    resource_uid: '',
    resource_api_version: 'v1',
    owner_kind: 'ReplicaSet',
    owner_name: 'some-rs',
    node_name: 'node-1',
    health_score: 50,
    is_spof: 0,
    blast_radius: 2,
    severity: 'high',
    correlation_group_id: 'cg-abc123',
    dimensions: null,
    ...overrides,
  };
}

describe('EventRow (collapsed)', () => {
  it('renders the full message as the primary visible line', () => {
    render(
      <MemoryRouter>
        <EventRow event={makeEvent() as never} onViewContext={vi.fn()} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Back-off restarting failed container busybox/),
    ).toBeInTheDocument();
  });

  it('message element has a title attribute with the full text', () => {
    render(
      <MemoryRouter>
        <EventRow event={makeEvent() as never} onViewContext={vi.fn()} />
      </MemoryRouter>,
    );
    const msg = screen.getByText(/Back-off restarting/);
    expect(msg).toHaveAttribute('title');
    expect(msg.getAttribute('title')).toContain('Back-off restarting');
  });

  it('secondary line shows kind, resource name, and aggregation count', () => {
    render(
      <MemoryRouter>
        <EventRow event={makeEvent() as never} onViewContext={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Pod')).toBeInTheDocument();
    expect(screen.getByText('wrong-container-command-pod')).toBeInTheDocument();
    expect(screen.getByText('x7')).toBeInTheDocument();
  });
});
