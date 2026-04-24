import { describe, it, expect } from 'vitest';
import { logicalIdentityEqual, logicalIdentityKey } from './resilient';

describe('logicalIdentity', () => {
  it('equals case-insensitive host', () => {
    expect(logicalIdentityEqual(
      { name: 'prod', serverUrl: 'https://X.example.com:6443' },
      { name: 'prod', serverUrl: 'https://x.example.com:6443' }
    )).toBe(true);
  });

  it('differs on case-sensitive name', () => {
    expect(logicalIdentityEqual(
      { name: 'PROD', serverUrl: 'https://x:6443' },
      { name: 'prod', serverUrl: 'https://x:6443' }
    )).toBe(false);
  });

  it('trailing slash is ignored', () => {
    expect(logicalIdentityKey({ name: 'a', serverUrl: 'https://x/' }))
      .toBe(logicalIdentityKey({ name: 'a', serverUrl: 'https://x' }));
  });
});
