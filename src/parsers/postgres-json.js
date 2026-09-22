// src/parsers/postgres-json.js — PostgreSQL JSON EXPLAIN parser
// Browser-compatible ES module

import { createPlanNode, resetNodeIds } from "../core/types.js";

/**
 * Parse a PostgreSQL JSON EXPLAIN plan into a PlanNode tree.
 *
 * Accepts the output of:
 *   EXPLAIN (FORMAT JSON) ...
 *   EXPLAIN (ANALYZE, FORMAT JSON) ...
 *   EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ...
 *
 * @param {any} json — parsed JSON (array or object)
 * @returns {{ tree: import('../core/types.js').PlanNode|null, planningTimeMs?: number, executionTimeMs?: number, error?: string }}
 */
export function parsePostgresJson(json) {
  resetNodeIds();

  // PostgreSQL wraps in an array: [{ "Plan": {...}, "Planning Time": ..., "Execution Time": ... }]
  const wrapper = Array.isArray(json) ? json[0] : json;

  if (!wrapper || typeof wrapper !== "object") {
    return { tree: null, error: "JSON does not contain a recognizable PostgreSQL plan structure." };
  }

  // The plan root can be wrapper.Plan or wrapper itself (if someone passes just the Plan node)
  const planRoot = wrapper.Plan || (wrapper["Node Type"] ? wrapper : null);

  if (!planRoot || typeof planRoot !== "object" || !planRoot["Node Type"]) {
    return { tree: null, error: "No 'Plan' object with 'Node Type' found in JSON." };
  }

  const planningTimeMs = wrapper["Planning Time"] ?? undefined;
  const executionTimeMs = wrapper["Execution Time"] ?? undefined;

  const tree = traverseNode(planRoot, 0);

  return { tree, planningTimeMs, executionTimeMs };
}

/**
 * Recursively convert a PostgreSQL JSON plan node into a PlanNode.
 *
 * @param {Object} node — raw JSON node
 * @param {number} depth
 * @returns {import('../core/types.js').PlanNode}
 */
function traverseNode(node, depth) {
  const operation = node["Node Type"] || "Unknown";

  // Parse children first
  const children = [];
  if (Array.isArray(node.Plans)) {
    for (const childNode of node.Plans) {
      children.push(traverseNode(childNode, depth + 1));
    }
  }

  // Extract sort key / group key arrays
  const sortKey = extractStringArray(node["Sort Key"]);
  const groupKey = extractStringArray(node["Group Key"]);

  // Extract join condition — could be Hash Cond, Merge Cond, or Join Filter
  const joinCondition = node["Hash Cond"] || node["Merge Cond"] || node["Join Filter"] || undefined;

  // Build the PlanNode
  const planNode = createPlanNode({
    engine: "postgresql",
    operation,
    depth,

    // Relation info
    relation: node["Relation Name"] ?? undefined,
    alias: node["Alias"] ?? undefined,
    index: node["Index Name"] ?? undefined,

    // Estimates
    estimatedRows: node["Plan Rows"] ?? undefined,
    estimatedCostStart: node["Startup Cost"] ?? undefined,
    estimatedCostTotal: node["Total Cost"] ?? undefined,
    width: node["Plan Width"] ?? undefined,

    // Actuals (from ANALYZE)
    actualRows: node["Actual Rows"] ?? undefined,
    loops: node["Actual Loops"] ?? undefined,
    startupTimeMs: node["Actual Startup Time"] ?? undefined,
    inclusiveTimeMs: node["Actual Total Time"] ?? undefined,

    // Conditions
    filter: node["Filter"] ?? undefined,
    indexCondition: node["Index Cond"] ?? undefined,
    joinCondition,
    sortKey,
    groupKey,
    sortMethod: node["Sort Method"] ?? undefined,
    sortSpaceUsedKb: node["Sort Space Used"] ?? undefined,
    sortSpaceType: node["Sort Space Type"] ?? undefined,

    // Rows removed
    rowsRemovedByFilter: node["Rows Removed by Filter"] ?? undefined,
    rowsRemovedByJoinFilter: node["Rows Removed by Join Filter"] ?? undefined,

    // Buffers
    sharedHitBlocks: node["Shared Hit Blocks"] ?? undefined,
    sharedReadBlocks: node["Shared Read Blocks"] ?? undefined,
    sharedDirtiedBlocks: node["Shared Dirtied Blocks"] ?? undefined,
    sharedWrittenBlocks: node["Shared Written Blocks"] ?? undefined,
    tempReadBlocks: node["Temp Read Blocks"] ?? undefined,
    tempWrittenBlocks: node["Temp Written Blocks"] ?? undefined,

    // I/O timing
    ioReadTimeMs: node["I/O Read Time"] ?? undefined,
    ioWriteTimeMs: node["I/O Write Time"] ?? undefined,

    // Parallel
    workersPlanned: node["Workers Planned"] ?? undefined,
    workersLaunched: node["Workers Launched"] ?? undefined,

    // Other
    heapFetches: node["Heap Fetches"] ?? undefined,

    // All remaining fields go into metadata
    metadata: extractMetadata(node),

    children,
  });

  return planNode;
}

/**
 * Extract a string array from a JSON field that could be an array or a single string.
 * @param {any} value
 * @returns {string[]|undefined}
 */
function extractStringArray(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/**
 * Extract metadata — all fields we don't explicitly parse.
 * Excludes "Plans" (children) and the fields we already extract.
 *
 * @param {Object} node
 * @returns {Record<string, unknown>}
 */
function extractMetadata(node) {
  const knownKeys = new Set([
    "Node Type", "Plans",
    "Relation Name", "Alias", "Index Name",
    "Plan Rows", "Startup Cost", "Total Cost", "Plan Width",
    "Actual Rows", "Actual Loops", "Actual Startup Time", "Actual Total Time",
    "Filter", "Index Cond", "Hash Cond", "Merge Cond", "Join Filter",
    "Recheck Cond",
    "Sort Key", "Sort Method", "Sort Space Used", "Sort Space Type",
    "Group Key",
    "Rows Removed by Filter", "Rows Removed by Join Filter",
    "Shared Hit Blocks", "Shared Read Blocks", "Shared Dirtied Blocks", "Shared Written Blocks",
    "Temp Read Blocks", "Temp Written Blocks",
    "I/O Read Time", "I/O Write Time",
    "Workers Planned", "Workers Launched",
    "Heap Fetches",
  ]);

  const meta = {};
  for (const [key, value] of Object.entries(node)) {
    if (!knownKeys.has(key)) {
      meta[key] = value;
    }
  }

  // Also include Recheck Cond in metadata — useful display info
  if (node["Recheck Cond"]) {
    meta["Recheck Cond"] = node["Recheck Cond"];
  }

  return meta;
}
