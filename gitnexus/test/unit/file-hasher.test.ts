/**
 * Unit Tests: file-hasher.ts
 *
 * Tests: computeFileHashes, diffFileHashes
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { computeFileHashes, diffFileHashes } from '../../src/storage/file-hasher.js';

// ---------------------------------------------------------------------------
// computeFileHashes
// ---------------------------------------------------------------------------

describe('computeFileHashes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-hasher-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns correct SHA-256 hash for a real file', async () => {
    const content = 'hello world';
    await fs.writeFile(path.join(tmpDir, 'a.txt'), content);

    const expected = createHash('sha256').update(Buffer.from(content)).digest('hex');
    const result = await computeFileHashes(tmpDir, ['a.txt']);

    expect(result['a.txt']).toBe(expected);
  });

  it('handles multiple files and returns all hashes', async () => {
    await fs.writeFile(path.join(tmpDir, 'b.ts'), 'export const x = 1;');
    await fs.writeFile(path.join(tmpDir, 'c.ts'), 'export const y = 2;');

    const result = await computeFileHashes(tmpDir, ['b.ts', 'c.ts']);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['b.ts']).toBeTruthy();
    expect(result['c.ts']).toBeTruthy();
    expect(result['b.ts']).not.toBe(result['c.ts']);
  });

  it('skips missing files gracefully without throwing', async () => {
    await fs.writeFile(path.join(tmpDir, 'exists.ts'), 'const x = 1;');

    const result = await computeFileHashes(tmpDir, ['exists.ts', 'does-not-exist.ts']);

    expect(result['exists.ts']).toBeTruthy();
    expect(result['does-not-exist.ts']).toBeUndefined();
  });

  it('returns empty object for empty file list', async () => {
    const result = await computeFileHashes(tmpDir, []);
    expect(result).toEqual({});
  });

  it('produces different hashes for files with different content', async () => {
    await fs.writeFile(path.join(tmpDir, 'v1.ts'), 'const x = 1;');
    await fs.writeFile(path.join(tmpDir, 'v2.ts'), 'const x = 2;');

    const result = await computeFileHashes(tmpDir, ['v1.ts', 'v2.ts']);

    expect(result['v1.ts']).not.toBe(result['v2.ts']);
  });
});

// ---------------------------------------------------------------------------
// diffFileHashes
// ---------------------------------------------------------------------------

describe('diffFileHashes', () => {
  it('returns all files as changed when previousHashes is undefined', () => {
    const current = { 'a.ts': 'hash1', 'b.ts': 'hash2' };
    const diff = diffFileHashes(current, undefined);

    expect(diff.changed).toHaveLength(2);
    expect(diff.changed).toContain('a.ts');
    expect(diff.changed).toContain('b.ts');
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toBe(0);
  });

  it('returns no changes when hashes are identical', () => {
    const hashes = { 'a.ts': 'hash1', 'b.ts': 'hash2' };
    const diff = diffFileHashes(hashes, { ...hashes });

    expect(diff.changed).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.unchanged).toBe(2);
  });

  it('detects changed files when hash differs', () => {
    const current = { 'a.ts': 'new-hash' };
    const previous = { 'a.ts': 'old-hash' };
    const diff = diffFileHashes(current, previous);

    expect(diff.changed).toContain('a.ts');
    expect(diff.unchanged).toBe(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('detects new files (present in current but absent in previous)', () => {
    const current = { 'a.ts': 'hash1', 'new.ts': 'hash2' };
    const previous = { 'a.ts': 'hash1' };
    const diff = diffFileHashes(current, previous);

    expect(diff.changed).toContain('new.ts');
    expect(diff.unchanged).toBe(1);
    expect(diff.removed).toHaveLength(0);
  });

  it('detects removed files (present in previous but absent in current)', () => {
    const current = { 'a.ts': 'hash1' };
    const previous = { 'a.ts': 'hash1', 'gone.ts': 'oldhash' };
    const diff = diffFileHashes(current, previous);

    expect(diff.removed).toContain('gone.ts');
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it('handles mixed scenario: changed, removed, and unchanged', () => {
    const current = { 'same.ts': 'hash1', 'changed.ts': 'new-hash', 'added.ts': 'hash3' };
    const previous = { 'same.ts': 'hash1', 'changed.ts': 'old-hash', 'removed.ts': 'hash4' };
    const diff = diffFileHashes(current, previous);

    expect(diff.unchanged).toBe(1);
    expect(diff.changed).toContain('changed.ts');
    expect(diff.changed).toContain('added.ts');
    expect(diff.removed).toContain('removed.ts');
    expect(diff.changed).not.toContain('same.ts');
  });
});
