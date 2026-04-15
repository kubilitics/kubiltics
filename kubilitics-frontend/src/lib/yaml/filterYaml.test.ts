import { describe, it, expect } from 'vitest';
import { filterYaml, toJson, isLargeResource, wellKnownFoldPaths } from './filterYaml';

describe('filterYaml', () => {
  it("'raw' returns input unchanged (reference equality)", () => {
    const input = { kind: 'Pod', metadata: { managedFields: [1, 2, 3] } };
    expect(filterYaml(input, 'raw')).toBe(input);
  });

  it("'clean' removes metadata.managedFields", () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).not.toHaveProperty('managedFields');
    expect(out.metadata.name).toBe('p');
  });

  it("'clean' is a no-op when managedFields is absent", () => {
    const input = { kind: 'Pod', metadata: { name: 'p' } };
    const out = filterYaml(input, 'clean') as { metadata: Record<string, unknown> };
    expect(out.metadata).toEqual({ name: 'p' });
  });

  it("'clean' keeps status, spec, and other metadata fields intact", () => {
    const input = {
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: {
        name: 'p',
        namespace: 'default',
        uid: 'abc-123',
        resourceVersion: '42',
        generation: 1,
        creationTimestamp: '2026-04-16T00:00:00Z',
        managedFields: [{ manager: 'kubelet' }],
        labels: { app: 'x' },
      },
      spec: { containers: [{ name: 'c', image: 'nginx' }] },
      status: { phase: 'Running', podIP: '10.0.0.1' },
    };
    const out = filterYaml(input, 'clean') as typeof input;
    expect(out.kind).toBe('Pod');
    expect(out.apiVersion).toBe('v1');
    expect(out.spec).toEqual(input.spec);
    expect(out.status).toEqual(input.status);
    expect(out.metadata.name).toBe('p');
    expect(out.metadata.namespace).toBe('default');
    expect(out.metadata.uid).toBe('abc-123');
    expect(out.metadata.resourceVersion).toBe('42');
    expect(out.metadata.generation).toBe(1);
    expect(out.metadata.creationTimestamp).toBe('2026-04-16T00:00:00Z');
    expect(out.metadata.labels).toEqual({ app: 'x' });
  });

  it('does not mutate its input when filtering', () => {
    const input = {
      kind: 'Pod',
      metadata: {
        name: 'p',
        managedFields: [{ manager: 'kubelet' }],
      },
    };
    const snapshot = JSON.stringify(input);
    filterYaml(input, 'clean');
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles missing or non-object metadata gracefully', () => {
    expect(filterYaml({ kind: 'Pod' }, 'clean')).toEqual({ kind: 'Pod' });
    expect(filterYaml({ kind: 'Pod', metadata: null }, 'clean')).toEqual({
      kind: 'Pod',
      metadata: null,
    });
  });

  it('passes null, undefined, and primitives through unchanged', () => {
    expect(filterYaml(null, 'clean')).toBe(null);
    expect(filterYaml(undefined, 'clean')).toBe(undefined);
    expect(filterYaml('string', 'clean')).toBe('string');
    expect(filterYaml(42, 'clean')).toBe(42);
  });
});

describe("filterYaml — 'apply-ready' preset", () => {
  const fullPod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'nginx',
      namespace: 'default',
      labels: { app: 'nginx' },
      annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
      uid: 'abc-123',
      resourceVersion: '42',
      creationTimestamp: '2026-04-16T00:00:00Z',
      generation: 1,
      selfLink: '/api/v1/namespaces/default/pods/nginx',
      ownerReferences: [{ kind: 'ReplicaSet', name: 'nginx-rs', uid: 'rs-uid' }],
      managedFields: [{ manager: 'kubelet' }],
    },
    spec: { containers: [{ name: 'c', image: 'nginx' }] },
    status: { phase: 'Running', podIP: '10.0.0.1' },
  };

  it('strips every server-managed field', () => {
    const out = filterYaml(fullPod, 'apply-ready') as typeof fullPod;
    expect(out.metadata).not.toHaveProperty('uid');
    expect(out.metadata).not.toHaveProperty('resourceVersion');
    expect(out.metadata).not.toHaveProperty('creationTimestamp');
    expect(out.metadata).not.toHaveProperty('generation');
    expect(out.metadata).not.toHaveProperty('selfLink');
    expect(out.metadata).not.toHaveProperty('ownerReferences');
    expect(out.metadata).not.toHaveProperty('managedFields');
    expect(out).not.toHaveProperty('status');
  });

  it('keeps name, namespace, labels, annotations, spec intact', () => {
    const out = filterYaml(fullPod, 'apply-ready') as typeof fullPod;
    expect(out.apiVersion).toBe('v1');
    expect(out.kind).toBe('Pod');
    expect(out.metadata.name).toBe('nginx');
    expect(out.metadata.namespace).toBe('default');
    expect(out.metadata.labels).toEqual({ app: 'nginx' });
    expect(out.metadata.annotations).toEqual({ 'kubectl.kubernetes.io/last-applied-configuration': '{}' });
    expect(out.spec).toEqual(fullPod.spec);
  });

  it('does not mutate input', () => {
    const snapshot = JSON.stringify(fullPod);
    filterYaml(fullPod, 'apply-ready');
    expect(JSON.stringify(fullPod)).toBe(snapshot);
  });

  it('is a no-op on already-minimal objects', () => {
    const minimal = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'empty', namespace: 'default' },
      data: { foo: 'bar' },
    };
    const out = filterYaml(minimal, 'apply-ready') as typeof minimal;
    expect(out.metadata.name).toBe('empty');
    expect(out.data).toEqual({ foo: 'bar' });
  });
});

describe('toJson', () => {
  it('produces valid JSON parseable by JSON.parse', () => {
    const obj = { kind: 'Pod', metadata: { name: 'p' } };
    const text = toJson(obj);
    expect(JSON.parse(text)).toEqual(obj);
  });

  it('indents to 2 spaces by default', () => {
    const text = toJson({ a: 1 });
    expect(text).toBe('{\n  "a": 1\n}');
  });

  it('respects the indent option', () => {
    const text = toJson({ a: 1 }, { indent: 0 });
    expect(text).toBe('{"a":1}');
  });
});

describe('isLargeResource', () => {
  it('is true above 1 MB', () => {
    expect(isLargeResource('x'.repeat(1_048_577))).toBe(true);
  });
  it('is false just under 1 MB', () => {
    expect(isLargeResource('x'.repeat(1_048_575))).toBe(false);
  });
  it('is false for empty input', () => {
    expect(isLargeResource('')).toBe(false);
  });
});

describe('wellKnownFoldPaths', () => {
  it('returns exactly three stable entries', () => {
    const paths = wellKnownFoldPaths();
    expect(paths).toHaveLength(3);
    expect(paths.map((p) => p.path)).toEqual([
      'metadata.managedFields',
      'status',
      'spec.template',
    ]);
    expect(paths.map((p) => p.label)).toEqual([
      'Fold managedFields',
      'Fold status',
      'Fold spec.template',
    ]);
  });

  it('is referentially stable across calls (for memoization safety)', () => {
    const a = wellKnownFoldPaths();
    const b = wellKnownFoldPaths();
    expect(a).toEqual(b);
  });
});
