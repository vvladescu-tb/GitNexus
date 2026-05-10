/**
 * Subgraph extraction for incremental DB writeback.
 *
 * Given the FULL ctx.graph produced by the pipeline (all files parsed,
 * all phases run) and the set of file paths whose DB rows must be
 * replaced, produce a smaller KnowledgeGraph that contains:
 *
 *   - Every node whose `properties.filePath` is in the EXPANDED writable set.
 *   - Every graph-wide node (Community, Process) — these are regenerated
 *     each run by the communities/processes phases and must be fully
 *     rewritten.
 *   - Every relationship where AT LEAST ONE endpoint is in the writable
 *     set above. Relationships entirely between unchanged-file nodes
 *     are skipped — their rows are still in the DB and re-inserting
 *     them would PK-conflict at COPY time.
 *
 * # Cross-file edge consistency (Finding 1 fix)
 *
 * The "AT LEAST ONE writable endpoint" rule alone is unsafe. Consider a
 * barrel re-export change: file C (a barrel) shifts
 * `export { foo } from './b'` to `export { foo } from './d'`. After
 * scope resolution, file A's CALLS edge to `foo` resolves to D instead
 * of B, even though A's content is byte-for-byte identical.
 *
 *   - Old A→B edge survives in DB (neither A nor B is changed → not deleted)
 *   - New A→D edge is missing (neither A nor D in writable set → skipped)
 *
 * Fix: expand `toWriteSet` BEFORE deciding writability. For every
 * relationship in the new graph that crosses the writable boundary
 * (one endpoint in a changed file, the other in an unchanged file),
 * the unchanged-side file is also marked writable. The orchestrator's
 * `DETACH DELETE` then cleans up the stale unchanged-side rows before
 * re-insertion, and the new cross-file edges land correctly because at
 * least one endpoint is now writable.
 *
 * Limitation (documented): if a file X *stopped* importing from a
 * changed file C, X has no edge to C in the new graph, so this 1-hop
 * walk doesn't catch it — the stale X→C edge remains in the DB until
 * the next `analyze --force`. Closing this gap requires querying the
 * pre-run DB for incoming edges to changed files, which is the
 * orchestrator's responsibility, not the subgraph extractor's.
 */

import type { GraphNode, GraphRelationship } from 'gitnexus-shared';
import { createKnowledgeGraph } from '../graph/graph.js';
import type { KnowledgeGraph } from '../graph/types.js';

const isGraphWide = (label: string): boolean => label === 'Community' || label === 'Process';

/**
 * Build a Map<nodeId, filePath> for every File-bound node in the graph.
 * Graph-wide nodes (Community/Process) have no filePath and are filtered.
 */
const indexNodeFilePaths = (fullGraph: KnowledgeGraph): Map<string, string> => {
  const idx = new Map<string, string>();
  fullGraph.forEachNode((n: GraphNode) => {
    const fp = n.properties?.filePath as string | undefined;
    if (fp) idx.set(n.id, fp);
  });
  return idx;
};

/**
 * Walk the new graph's edges once. For every edge crossing the writable
 * boundary, add the non-writable side's filePath to the expanded set.
 * Returns a NEW set (does not mutate the caller's input).
 */
const expandWriteSet = (
  fullGraph: KnowledgeGraph,
  toWriteSet: ReadonlySet<string>,
  nodeFilePaths: ReadonlyMap<string, string>,
): Set<string> => {
  const expanded = new Set<string>(toWriteSet);
  fullGraph.forEachRelationship((r: GraphRelationship) => {
    const sourcePath = nodeFilePaths.get(r.sourceId);
    const targetPath = nodeFilePaths.get(r.targetId);
    if (!sourcePath || !targetPath) return; // skip edges to graph-wide nodes
    const sourceWritable = toWriteSet.has(sourcePath);
    const targetWritable = toWriteSet.has(targetPath);
    if (sourceWritable && !targetWritable) expanded.add(targetPath);
    else if (targetWritable && !sourceWritable) expanded.add(sourcePath);
  });
  return expanded;
};

export const extractChangedSubgraph = (
  fullGraph: KnowledgeGraph,
  toWriteSet: ReadonlySet<string>,
): KnowledgeGraph => {
  const sub = createKnowledgeGraph();
  const nodeFilePaths = indexNodeFilePaths(fullGraph);
  const effectiveWriteSet = expandWriteSet(fullGraph, toWriteSet, nodeFilePaths);
  const writableNodeIds = new Set<string>();

  fullGraph.forEachNode((n: GraphNode) => {
    const filePath = n.properties?.filePath as string | undefined;
    const include = (filePath && effectiveWriteSet.has(filePath)) || isGraphWide(n.label);
    if (include) {
      sub.addNode(n);
      writableNodeIds.add(n.id);
    }
  });

  fullGraph.forEachRelationship((r: GraphRelationship) => {
    if (writableNodeIds.has(r.sourceId) || writableNodeIds.has(r.targetId)) {
      sub.addRelationship(r);
    }
  });

  return sub;
};

/**
 * Public — exposed for the orchestrator to derive the expanded set of
 * files whose DB rows must be `DETACH DELETE`d before writeback.
 *
 * Without this, the orchestrator only deletes original-toWriteSet rows,
 * leaving stale rows for the 1-hop-expanded files. The expanded set
 * MUST be the input to both `deleteNodesForFile` and
 * `extractChangedSubgraph` for consistency.
 */
export const computeEffectiveWriteSet = (
  fullGraph: KnowledgeGraph,
  toWriteSet: ReadonlySet<string>,
): Set<string> => {
  const nodeFilePaths = indexNodeFilePaths(fullGraph);
  return expandWriteSet(fullGraph, toWriteSet, nodeFilePaths);
};
