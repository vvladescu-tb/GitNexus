import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from '../../src/services/backend-client';

describe('normalizeServerUrl', () => {
  it('adds http:// to localhost', () => {
    expect(normalizeServerUrl('localhost:4747')).toBe('http://localhost:4747');
  });

  it('adds http:// to 127.0.0.1', () => {
    expect(normalizeServerUrl('127.0.0.1:4747')).toBe('http://127.0.0.1:4747');
  });

  it('adds https:// to non-local hosts', () => {
    expect(normalizeServerUrl('example.com')).toBe('https://example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeServerUrl('http://localhost:4747/')).toBe('http://localhost:4747');
    expect(normalizeServerUrl('http://localhost:4747///')).toBe('http://localhost:4747');
  });

  it('strips /api suffix (base URL only)', () => {
    expect(normalizeServerUrl('http://localhost:4747/api')).toBe('http://localhost:4747');
  });

  it('trims whitespace', () => {
    expect(normalizeServerUrl('  localhost:4747  ')).toBe('http://localhost:4747');
  });

  it('preserves existing https://', () => {
    expect(normalizeServerUrl('https://gitnexus.example.com')).toBe('https://gitnexus.example.com');
  });
});
