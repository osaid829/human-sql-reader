// src/core/types.js — Core type definitions and factory functions
// Browser-compatible ES module — no Node.js dependencies

/**
 * @typedef {'postgresql' | 'mysql'} Engine
 * @typedef {'json' | 'text' | 'tabular' | 'tree'} PlanFormat
 * @typedef {'info' | 'low' | 'medium' | 'high' | 'critical'} Severity
 * @typedef {'low' | 'medium' | 'high'} Confidence
 */

/**
 * @typedef {Object} PlanNode
 * @property {string} id
 * @property {Engine} engine
 * @property {string} operation
 * @property {string} [relation]
 * @property {string} [alias]
 * @property {string} [index]
 * @property {number} [estimatedRows]
 * @property {number} [actualRows]
 * @property {number} [loops]
 * @property {number} [estimatedCostStart]
 * @property {number} [estimatedCostTotal]
 * @property {number} [startupTimeMs]
 * @property {number} [inclusiveTimeMs]
 * @property {number} [exclusiveTimeMsApprox]
 * @property {number} [width]
 * @property {string} [filter]
 * @property {string} [indexCondition]
 * @property {string} [joinCondition]
 * @property {string[]} [sortKey]
 * @property {string[]} [groupKey]
 * @property {string} [sortMethod]
 * @property {number} [sortSpaceUsedKb]
 * @property {string} [sortSpaceType]
 * @property {number} [rowsRemovedByFilter]
 * @property {number} [rowsRemovedByJoinFilter]
 * @property {number} [heapFetches]
 * @property {number} [workersPlanned]
 * @property {number} [workersLaunched]
 * @property {number} [sharedHitBlocks]
 * @property {number} [sharedReadBlocks]
 * @property {number} [sharedDirtiedBlocks]
 * @property {number} [sharedWrittenBlocks]
 * @property {number} [tempReadBlocks]
 * @property {number} [tempWrittenBlocks]
 * @property {number} [ioReadTimeMs]
 * @property {number} [ioWriteTimeMs]
 * @property {Record<string, unknown>} metadata
 * @property {PlanNode[]} children
 * @property {number} [depth]
 * @property {number} [totalRowsApprox]
 * @property {number} [actualRowsPerLoop]
 */

/**
 * @typedef {Object} EvidenceItem
 * @property {string} label
 * @property {string|number} value
 * @property {string} [unit]
 */

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {Severity} severity
 * @property {Confidence} confidence
 * @property {string} category
 * @property {string} title
 * @property {string} summary
 * @property {EvidenceItem[]} evidence
 * @property {string} [recommendation]
 * @property {string[]} nodeIds
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {Engine} engine
 * @property {PlanFormat} format
 * @property {boolean} hasActualMetrics
 * @property {number} [planningTimeMs]
 * @property {number} [executionTimeMs]
 * @property {PlanNode} tree
 * @property {PlanNode[]} flatNodes  — pre-order traversal
 * @property {Finding[]} findings
 * @property {Object} summary
 * @property {string} summary.headline
 * @property {string} summary.detail
 * @property {Confidence} summary.confidence
 * @property {boolean} [parseError]
 * @property {string} [parseErrorMessage]
 */

// ── Severity ordering for sorting findings ──────────────────────────────────
export const SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

let _nodeIdCounter = 0;

/** Reset node ID counter (useful for tests). */
export function resetNodeIds() {
  _nodeIdCounter = 0;
}

/** Generate a unique node ID. */
export function nextNodeId() {
  return `node-${++_nodeIdCounter}`;
}

/**
 * Create a PlanNode with defaults.
 * @param {Partial<PlanNode>} overrides
 * @returns {PlanNode}
 */
export function createPlanNode(overrides = {}) {
  return {
    id: overrides.id || nextNodeId(),
    engine: overrides.engine || "postgresql",
    operation: overrides.operation || "Unknown",
    relation: overrides.relation ?? undefined,
    alias: overrides.alias ?? undefined,
    index: overrides.index ?? undefined,
    estimatedRows: overrides.estimatedRows ?? undefined,
    actualRows: overrides.actualRows ?? undefined,
    loops: overrides.loops ?? undefined,
    estimatedCostStart: overrides.estimatedCostStart ?? undefined,
    estimatedCostTotal: overrides.estimatedCostTotal ?? undefined,
    startupTimeMs: overrides.startupTimeMs ?? undefined,
    inclusiveTimeMs: overrides.inclusiveTimeMs ?? undefined,
    exclusiveTimeMsApprox: overrides.exclusiveTimeMsApprox ?? undefined,
    width: overrides.width ?? undefined,
    filter: overrides.filter ?? undefined,
    indexCondition: overrides.indexCondition ?? undefined,
    joinCondition: overrides.joinCondition ?? undefined,
    sortKey: overrides.sortKey ?? undefined,
    groupKey: overrides.groupKey ?? undefined,
    sortMethod: overrides.sortMethod ?? undefined,
    sortSpaceUsedKb: overrides.sortSpaceUsedKb ?? undefined,
    sortSpaceType: overrides.sortSpaceType ?? undefined,
    rowsRemovedByFilter: overrides.rowsRemovedByFilter ?? undefined,
    rowsRemovedByJoinFilter: overrides.rowsRemovedByJoinFilter ?? undefined,
    heapFetches: overrides.heapFetches ?? undefined,
    workersPlanned: overrides.workersPlanned ?? undefined,
    workersLaunched: overrides.workersLaunched ?? undefined,
    sharedHitBlocks: overrides.sharedHitBlocks ?? undefined,
    sharedReadBlocks: overrides.sharedReadBlocks ?? undefined,
    sharedDirtiedBlocks: overrides.sharedDirtiedBlocks ?? undefined,
    sharedWrittenBlocks: overrides.sharedWrittenBlocks ?? undefined,
    tempReadBlocks: overrides.tempReadBlocks ?? undefined,
    tempWrittenBlocks: overrides.tempWrittenBlocks ?? undefined,
    ioReadTimeMs: overrides.ioReadTimeMs ?? undefined,
    ioWriteTimeMs: overrides.ioWriteTimeMs ?? undefined,
    metadata: overrides.metadata || {},
    children: overrides.children || [],
    depth: overrides.depth ?? 0,
  };
}

/**
 * Flatten a PlanNode tree into a pre-order list.
 * @param {PlanNode} root
 * @returns {PlanNode[]}
 */
export function flattenTree(root) {
  const result = [];
  function walk(node) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  walk(root);
  return result;
}
