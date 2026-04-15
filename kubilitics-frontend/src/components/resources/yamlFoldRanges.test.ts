import { describe, it, expect } from 'vitest';
import { findFoldRange } from './yamlFoldRanges';

const pod = `apiVersion: v1
kind: Pod
metadata:
  name: nginx
  namespace: default
  managedFields:
    - manager: kubelet
      operation: Update
spec:
  containers:
    - name: nginx
      image: nginx:1.25
status:
  phase: Running
  podIP: 10.0.0.1
`;

const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
`;

describe('findFoldRange', () => {
  it('finds top-level status block', () => {
    const r = findFoldRange(pod, 'status');
    expect(r).toEqual({ startLine: 13, endLine: 15 });
  });

  it('finds metadata.managedFields when nested', () => {
    const r = findFoldRange(pod, 'metadata.managedFields');
    expect(r).toEqual({ startLine: 6, endLine: 8 });
  });

  it('finds spec.template in a Deployment', () => {
    const r = findFoldRange(deployment, 'spec.template');
    expect(r).toEqual({ startLine: 7, endLine: 14 });
  });

  it('returns null when the path is absent', () => {
    expect(findFoldRange(pod, 'spec.template')).toBeNull();
  });

  it('does not match a key that is a prefix substring', () => {
    const withStatuses = `apiVersion: v1
kind: Pod
metadata:
  name: p
spec:
  containers: []
statuses:
  - foo
`;
    expect(findFoldRange(withStatuses, 'status')).toBeNull();
  });

  it('handles empty input', () => {
    expect(findFoldRange('', 'status')).toBeNull();
  });

  it('handles single-line input without a body', () => {
    expect(findFoldRange('kind: Pod\n', 'status')).toBeNull();
  });

  it('returns null when a child segment is missing under its parent', () => {
    const cleaned = `apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: c
`;
    expect(findFoldRange(cleaned, 'metadata.managedFields')).toBeNull();
  });
});
