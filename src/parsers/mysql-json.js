// src/parsers/mysql-json.js — MySQL JSON EXPLAIN parser
// Browser-compatible ES module

import { createPlanNode, resetNodeIds } from "../core/types.js";

/**
 * Parse MySQL EXPLAIN FORMAT=JSON into a PlanNode tree.
 *
 * MySQL JSON EXPLAIN has structure:
 * { "query_block": { "select_id": 1, "cost_info": {...}, "table": {...}, "nested_loop": [...], ... } }
 *
 * @param {any} json — parsed JSON
 * @returns {{ tree: import('../core/types.js').PlanNode|null, queryCost?: number, error?: string }}
 */
export function parseMysqlJson(json) {
  resetNodeIds();

  const qb = json?.query_block ?? json;
  if (!qb || typeof qb !== "object") {
    return { tree: null, error: "JSON does not contain a recognizable MySQL query_block structure." };
  }

  const queryCost = qb.cost_info?.query_cost ? parseFloat(qb.cost_info.query_cost) : undefined;

  const tree = walkBlock(qb);

  if (!tree) {
    return { tree: null, error: "No tables or operations found in MySQL JSON plan." };
  }

  return { tree, queryCost };
}

/**
 * Walk a MySQL JSON query block and build a PlanNode tree.
 *
 * @param {Object} block
 * @returns {import('../core/types.js').PlanNode|null}
 */
function walkBlock(block) {
  if (!block || typeof block !== "object") return null;

  const children = [];
  let rootOp = "Query Block";
  let hasMeaningfulRoot = false;

  // ── Ordering operation (filesort) ─────────────────────────────────────
  if (block.ordering_operation) {
    const ordering = block.ordering_operation;
    const sortNode = createPlanNode({
      engine: "mysql",
      operation: ordering.using_filesort ? "Filesort" : "Sort",
      metadata: {
        using_filesort: ordering.using_filesort ?? false,
        using_temporary_table: ordering.using_temporary_table ?? false,
      },
      children: [],
    });

    // Recurse into the ordering operation
    const innerChildren = extractChildren(ordering);
    sortNode.children = innerChildren;
    children.push(sortNode);
    hasMeaningfulRoot = true;
    rootOp = "Sort Operation";
  }

  // ── Grouping operation ────────────────────────────────────────────────
  if (block.grouping_operation) {
    const grouping = block.grouping_operation;
    const groupNode = createPlanNode({
      engine: "mysql",
      operation: "Group",
      metadata: {
        using_filesort: grouping.using_filesort ?? false,
        using_temporary_table: grouping.using_temporary_table ?? false,
      },
      children: [],
    });

    const innerChildren = extractChildren(grouping);
    groupNode.children = innerChildren;
    children.push(groupNode);
    hasMeaningfulRoot = true;
    rootOp = "Group Operation";
  }

  // ── Duplicates removal ────────────────────────────────────────────────
  if (block.duplicates_removal) {
    const dedup = block.duplicates_removal;
    const dedupNode = createPlanNode({
      engine: "mysql",
      operation: "Duplicates Removal",
      children: [],
    });

    const innerChildren = extractChildren(dedup);
    dedupNode.children = innerChildren;
    children.push(dedupNode);
    hasMeaningfulRoot = true;
  }

  // ── Direct table or nested_loop at this level ─────────────────────────
  if (!hasMeaningfulRoot) {
    const directChildren = extractChildren(block);
    children.push(...directChildren);
  }

  // ── Subqueries ────────────────────────────────────────────────────────
  if (Array.isArray(block.subqueries)) {
    for (const sq of block.subqueries) {
      if (sq.query_block) {
        const subTree = walkBlock(sq.query_block);
        if (subTree) {
          subTree.operation = "Subquery";
          children.push(subTree);
        }
      }
    }
  }

  // If we only have children and no meaningful root, return a synthetic root
  if (children.length === 0) return null;

  if (children.length === 1 && !hasMeaningfulRoot) {
    return children[0];
  }

  return createPlanNode({
    engine: "mysql",
    operation: rootOp,
    children,
  });
}

/**
 * Extract child PlanNodes from a block that may contain table, nested_loop, etc.
 *
 * @param {Object} block
 * @returns {import('../core/types.js').PlanNode[]}
 */
function extractChildren(block) {
  const children = [];

  // Direct table
  if (block.table) {
    const node = parseTableNode(block.table);
    if (node) children.push(node);
  }

  // nested_loop array
  if (Array.isArray(block.nested_loop)) {
    const loopChildren = [];
    for (const entry of block.nested_loop) {
      if (entry.table) {
        const node = parseTableNode(entry.table);
        if (node) loopChildren.push(node);
      }
    }

    if (loopChildren.length > 0) {
      // If there are multiple tables in a nested loop, wrap them
      if (loopChildren.length > 1) {
        const nlNode = createPlanNode({
          engine: "mysql",
          operation: "Nested Loop",
          children: loopChildren,
        });
        children.push(nlNode);
      } else {
        children.push(...loopChildren);
      }
    }
  }

  // Recurse into nested blocks
  for (const key of ["ordering_operation", "grouping_operation", "duplicates_removal"]) {
    if (block[key] && !block.__processed?.[key]) {
      // Already handled at parent level
    }
  }

  return children;
}

/**
 * Convert a MySQL JSON table node into a PlanNode.
 *
 * @param {Object} tableNode
 * @returns {import('../core/types.js').PlanNode|null}
 */
function parseTableNode(tableNode) {
  if (!tableNode || typeof tableNode !== "object") return null;

  const accessType = tableNode.access_type ?? "unknown";
  const tableName = tableNode.table_name ?? undefined;

  // Map MySQL access_type to an operation name
  const opMap = {
    "ALL": "Full Table Scan",
    "index": "Full Index Scan",
    "range": "Index Range Scan",
    "ref": "Index Lookup (ref)",
    "eq_ref": "Unique Index Lookup (eq_ref)",
    "const": "Constant Lookup",
    "system": "System Table Lookup",
    "ref_or_null": "Index Lookup with NULL",
    "fulltext": "Fulltext Search",
    "index_merge": "Index Merge",
  };

  const operation = opMap[accessType] || `Table Access (${accessType})`;

  const possibleKeys = Array.isArray(tableNode.possible_keys)
    ? tableNode.possible_keys.join(", ")
    : tableNode.possible_keys ?? undefined;

  const key = tableNode.key ?? undefined;
  const keyLength = tableNode.key_length ? String(tableNode.key_length) : undefined;
  const rowsExamined = tableNode.rows_examined_per_scan ?? tableNode.rows_produced_per_join ?? undefined;
  const filtered = tableNode.filtered != null ? parseFloat(tableNode.filtered) : undefined;

  const cost = tableNode.cost_info?.eval_cost ? parseFloat(tableNode.cost_info.eval_cost) : undefined;
  const readCost = tableNode.cost_info?.read_cost ? parseFloat(tableNode.cost_info.read_cost) : undefined;

  return createPlanNode({
    engine: "mysql",
    operation,
    relation: tableName,
    index: key ?? undefined,
    estimatedRows: rowsExamined,
    estimatedCostTotal: cost ?? readCost,

    filter: tableNode.attached_condition ?? undefined,

    metadata: {
      accessType,
      possibleKeys,
      keyLength,
      filtered,
      usedColumns: tableNode.used_columns,
      using_temporary_table: tableNode.using_temporary_table ?? false,
      using_filesort: tableNode.using_filesort ?? false,
      ref: tableNode.ref,
      usedKeyParts: tableNode.used_key_parts,
    },
  });
}
