/**
 * Unit Tests: /tool/cypher.json wire format (SPEC-263 T004)
 *
 * Pure formatter tests for the JSON wire format added alongside the
 * existing markdown /tool/cypher endpoint. Goal: programmatic consumers
 * (argus codebase loader) get parsed rows ~5x faster without round-tripping
 * through Markdown.
 */
import { describe, it, expect } from 'vitest';
import { formatCypherAsJson } from '../../src/cli/eval-server.js';

describe('formatCypherAsJson', () => {
  it('returns error shape when backend produced {error}', () => {
    const out = formatCypherAsJson({ error: 'Repo not found' });
    expect(out).toEqual({ error: 'Repo not found' });
  });

  it('returns empty result for [] input', () => {
    const out = formatCypherAsJson([]);
    expect(out).toEqual({ columns: [], rows: [], row_count: 0 });
  });

  it('extracts columns from first row and emits 2D row matrix', () => {
    const rows = [
      { src: 'a.py::f', tgt: 'b.py::g', rel_type: 'CALLS' },
      { src: 'b.py::g', tgt: 'c.py::h', rel_type: 'CALLS' },
    ];
    const out = formatCypherAsJson(rows);
    expect(out).toEqual({
      columns: ['src', 'tgt', 'rel_type'],
      rows: [
        ['a.py::f', 'b.py::g', 'CALLS'],
        ['b.py::g', 'c.py::h', 'CALLS'],
      ],
      row_count: 2,
    });
  });

  it('preserves column order from first appearance across heterogeneous rows', () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 3, b: 4, c: 5 }, // c appears later
    ];
    const out = formatCypherAsJson(rows);
    if ('error' in out) throw new Error('expected success');
    expect(out.columns).toEqual(['a', 'b', 'c']);
    expect(out.rows[0]).toEqual([1, 2, null]); // missing c → null
    expect(out.rows[1]).toEqual([3, 4, 5]);
  });

  it('coerces non-array, non-error input to empty result', () => {
    expect(formatCypherAsJson('some string')).toEqual({
      columns: [],
      rows: [],
      row_count: 0,
    });
  });

  it('treats undefined cell values as null (JSON-safe)', () => {
    const rows = [{ a: 'x', b: undefined }];
    const out = formatCypherAsJson(rows);
    if ('error' in out) throw new Error('expected success');
    expect(out.rows[0]).toEqual(['x', null]);
  });

  it('handles object cell values without flattening — caller decides serialisation', () => {
    const rows = [{ id: '1', meta: { kind: 'fn' } }];
    const out = formatCypherAsJson(rows);
    if ('error' in out) throw new Error('expected success');
    // Object passes through; downstream JSON.stringify handles it.
    expect(out.rows[0][0]).toBe('1');
    expect(out.rows[0][1]).toEqual({ kind: 'fn' });
  });
});
