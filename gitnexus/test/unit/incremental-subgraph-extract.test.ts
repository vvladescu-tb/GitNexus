/**
 * Tests for incremental DB writeback subgraph extraction.
 *
 * Locks the Finding 1 fix (PR #1479 review): cross-file edges between
 * two unchanged files MUST land in the writeback subgraph when a third
 * (changed) file alters their cross-file resolution. The pre-fix
 * behaviour silently dropped those edges, leaving stale rows in the DB.
 *
 * These tests use synthetic graphs constructed via createKnowledgeGraph
 * directly — they don't run the parser, so they're cheap and stable.
 */

import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphRelationship } from 'gitnexus-shared';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import {
  extractChangedSubgraph,
  computeEffectiveWriteSet,
} from '../../src/core/incremental/subgraph-extract.js';

const makeFileNode = (id: string, filePath: string, label = 'Function'): GraphNode =>
  ({
    id,
    label,
    properties: { filePath, name: id },
  }) as unknown as GraphNode;

const makeWideNode = (id: string, label: 'Community' | 'Process'): GraphNode =>
  ({
    id,
    label,
    properties: {},
  }) as unknown as GraphNode;

const makeRel = (
  id: string,
  sourceId: string,
  targetId: string,
  type = 'CALLS',
): GraphRelationship =>
  ({
    id,
    sourceId,
    targetId,
    type,
    properties: {},
  }) as unknown as GraphRelationship;

describe('extractChangedSubgraph', () => {
  it('includes nodes whose filePath is in the explicit toWriteSet', () => {
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('a', '/repo/a.ts'));
    g.addNode(makeFileNode('c', '/repo/c.ts'));

    const sub = extractChangedSubgraph(g, new Set(['/repo/c.ts']));

    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['c']);
  });

  it('always includes graph-wide nodes (Community, Process)', () => {
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('a', '/repo/a.ts'));
    g.addNode(makeWideNode('comm-1', 'Community'));
    g.addNode(makeWideNode('proc-1', 'Process'));

    const sub = extractChangedSubgraph(g, new Set([])); // no files changed

    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['comm-1', 'proc-1']);
  });

  it('Finding 1 — barrel re-export expands the writable set to consumers', () => {
    // Scenario: file C (a barrel) used to re-export from B; now re-exports
    // from D. File A is unchanged byte-wise but its CALLS to foo() now
    // resolve to D instead of B. Both A and D are unchanged at the file
    // level — but A's edges have shifted.
    //
    // Pre-fix: toWriteSet={C} → A's nodes not deleted, A→D edge not
    //          inserted (neither endpoint writable). DB ends up with
    //          stale A→B and missing A→D.
    // Post-fix: A is 1-hop from C (A imports C in the new graph), so
    //          A is added to the effective write set. Subsequent
    //          deleteNodesForFile(A) clears the stale rows; subgraph
    //          now contains A and the new A→D edge.
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('a:fn', '/repo/a.ts'));
    g.addNode(makeFileNode('b:fn', '/repo/b.ts'));
    g.addNode(makeFileNode('c:re-export', '/repo/c.ts'));
    g.addNode(makeFileNode('d:fn', '/repo/d.ts'));
    // New graph: A imports from C (still does), A calls foo() now in D.
    g.addRelationship(makeRel('e1', 'a:fn', 'c:re-export', 'IMPORTS'));
    g.addRelationship(makeRel('e2', 'a:fn', 'd:fn', 'CALLS'));

    const effective = computeEffectiveWriteSet(g, new Set(['/repo/c.ts']));

    expect([...effective].sort()).toEqual(['/repo/a.ts', '/repo/c.ts']);
  });

  it('1-hop expansion picks up symmetric edges (B → C, where C changed)', () => {
    // Mirror of the previous case: an edge points INTO the changed file.
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('b:fn', '/repo/b.ts'));
    g.addNode(makeFileNode('c:fn', '/repo/c.ts'));
    g.addRelationship(makeRel('e1', 'b:fn', 'c:fn', 'CALLS'));

    const effective = computeEffectiveWriteSet(g, new Set(['/repo/c.ts']));

    expect([...effective].sort()).toEqual(['/repo/b.ts', '/repo/c.ts']);
  });

  it('does not expand unchanged-to-unchanged edges (no boundary crossed)', () => {
    // Two edges between two unchanged files — neither file should be
    // pulled into the write set.
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('x:fn', '/repo/x.ts'));
    g.addNode(makeFileNode('y:fn', '/repo/y.ts'));
    g.addRelationship(makeRel('e1', 'x:fn', 'y:fn', 'CALLS'));

    const effective = computeEffectiveWriteSet(g, new Set(['/repo/c.ts']));

    expect([...effective].sort()).toEqual(['/repo/c.ts']);
  });

  it('subgraph relationships fire when at least one endpoint is writable', () => {
    const g = createKnowledgeGraph();
    g.addNode(makeFileNode('a:fn', '/repo/a.ts'));
    g.addNode(makeFileNode('c:fn', '/repo/c.ts'));
    g.addRelationship(makeRel('e1', 'a:fn', 'c:fn', 'CALLS'));

    // Without expansion, A would be excluded from the subgraph and the
    // edge dropped. With expansion, A joins the effective write set,
    // both endpoints are writable, and the edge is included.
    const sub = extractChangedSubgraph(g, new Set(['/repo/c.ts']));

    expect(sub.nodes.map((n) => n.id).sort()).toEqual(['a:fn', 'c:fn']);
    expect(sub.relationships.map((r) => r.id)).toEqual(['e1']);
  });
});
