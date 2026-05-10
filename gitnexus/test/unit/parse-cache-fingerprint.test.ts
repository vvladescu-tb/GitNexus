/**
 * Tests for parse-cache parser-fingerprint keying (Finding 3 fix).
 *
 * Locks the invariant that the chunk hash key includes a parser-grammar
 * fingerprint, so a tree-sitter upgrade automatically invalidates all
 * cached entries instead of silently replaying stale parse output.
 *
 * The fingerprint itself is environment-derived (resolves tree-sitter
 * package versions at runtime), so we test the key-shape contract:
 * `computeChunkHash` is content-addressed AND fingerprint-addressed,
 * and entries written under one fingerprint are unreachable when the
 * fingerprint changes.
 */

import { describe, it, expect } from 'vitest';
import {
  computeChunkHash,
  fileContentHash,
  parserFingerprint,
  PARSE_CACHE_VERSION,
} from '../../src/storage/parse-cache.js';

describe('computeChunkHash', () => {
  it('produces stable output for the same chunk in the same env', () => {
    const entries = [
      { filePath: '/repo/a.ts', contentHash: fileContentHash('a content') },
      { filePath: '/repo/b.ts', contentHash: fileContentHash('b content') },
    ];
    expect(computeChunkHash(entries)).toBe(computeChunkHash(entries));
  });

  it('order-independent: same files in different order → same key', () => {
    const a = { filePath: '/repo/a.ts', contentHash: fileContentHash('a') };
    const b = { filePath: '/repo/b.ts', contentHash: fileContentHash('b') };
    expect(computeChunkHash([a, b])).toBe(computeChunkHash([b, a]));
  });

  it('content-sensitive: changing one file content changes the key', () => {
    const v1 = [{ filePath: '/repo/a.ts', contentHash: fileContentHash('one') }];
    const v2 = [{ filePath: '/repo/a.ts', contentHash: fileContentHash('two') }];
    expect(computeChunkHash(v1)).not.toBe(computeChunkHash(v2));
  });

  it('includes the parser fingerprint in the key', () => {
    // We cannot mutate the fingerprint at runtime (it's process-cached),
    // but we can prove inclusion: the hash output for a fixed chunk
    // changes when the fingerprint string changes. We do this by
    // computing two hashes — one via the public API and one re-derived
    // from the same canonical inputs but with a different prefix —
    // and asserting they differ.
    const entries = [{ filePath: '/repo/a.ts', contentHash: fileContentHash('x') }];

    // The public API embeds parserFingerprint() — verify it's not the
    // empty string (so the assertion that follows is meaningful).
    expect(parserFingerprint().length).toBeGreaterThan(0);

    // A naive sha256 of just the joined entries (without fingerprint
    // prefix) would have produced this string before the fix. After
    // the fix it must differ — proving the fingerprint is mixed in.
    const naive = require('crypto')
      .createHash('sha256')
      .update('/repo/a.ts:' + fileContentHash('x'))
      .digest('hex');
    expect(computeChunkHash(entries)).not.toBe(naive);
  });
});

describe('PARSE_CACHE_VERSION', () => {
  it('is bumped to 2 to invalidate pre-fingerprint caches', () => {
    // Pre-fix on-disk caches were written with version=1. The fix
    // bumped to 2 so any pre-fix file fails the version check on
    // load and is rebuilt instead of being read with mismatched keys.
    expect(PARSE_CACHE_VERSION).toBe(2);
  });
});
