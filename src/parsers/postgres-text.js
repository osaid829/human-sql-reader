// src/parsers/postgres-text.js — PostgreSQL text EXPLAIN parser
// Browser-compatible ES module
//
// Replaces the single giant regex approach with composable line parsing.
// Uses indentation to reconstruct the plan tree hierarchy.

import { createPlanNode, resetNodeIds } from "../core/types.js";

/**
 * Parse a PostgreSQL text EXPLAIN plan into a PlanNode tree.
 *
 * Supports both:
 *   EXPLAIN ...
 *   EXPLAIN (ANALYZE) ...
 *   EXPLAIN (ANALYZE, BUFFERS) ...
 *
 * @param {string} text — raw plan text
 * @returns {{ tree: import('../core/types.js').PlanNode|null, planningTimeMs?: number, executionTimeMs?: number, error?: string }}
 */
export function parsePostgresText(text) {
  resetNodeIds();

  const lines = text.split("\n");
  let planningTimeMs;
  let executionTimeMs;

  // Extract Planning/Execution Time from summary lines
  for (const line of lines) {
    const planningMatch = line.match(/Planning\s+Time:\s*([\d.]+)\s*ms/i);
    if (planningMatch) {
      planningTimeMs = parseFloat(planningMatch[1]);
    }
    const execMatch = line.match(/Execution\s+Time:\s*([\d.]+)\s*ms/i);
    if (execMatch) {
      executionTimeMs = parseFloat(execMatch[1]);
    }
  }

  // Parse node lines and their detail lines
  const nodeEntries = extractNodeEntries(lines);

  if (nodeEntries.length === 0) {
    return { tree: null, error: "Could not find any recognizable plan nodes in the text." };
  }

  // Build tree from indentation
  const tree = buildTree(nodeEntries);

  return { tree, planningTimeMs, executionTimeMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Line classification and node extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RawNodeEntry
 * @property {number} indent — depth level (from indentation)
 * @property {string} operation
 * @property {string} [relation]
 * @property {string} [alias]
 * @property {string} [index]
 * @property {number} [costStart]
 * @property {number} [costEnd]
 * @property {number} [rows]
 * @property {number} [width]
 * @property {number} [actualStartup]
 * @property {number} [actualEnd]
 * @property {number} [actualRows]
 * @property {number} [loops]
 * @property {string[]} detailLines — subsequent detail/attribute lines
 */

/**
 * Extract node entries from plan text lines.
 * Identifies node lines (containing operation + cost/actual) and collects
 * subsequent detail lines (Filter, Sort Key, etc.).
 *
 * @param {string[]} lines
 * @returns {RawNodeEntry[]}
 */
function extractNodeEntries(lines) {
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and summary lines
    if (line.trim().length === 0) continue;
    if (/^\s*(Planning|Execution)\s+(Time|time)/i.test(line)) continue;
    if (/^\s*JIT:/i.test(line)) continue;
    if (/^\s*Settings:/i.test(line)) continue;
    if (/^\s*Trigger\s+/i.test(line)) continue;

    // Try to parse as a node line
    const nodeInfo = parseNodeLine(line);
    if (nodeInfo) {
      // Collect subsequent detail lines
      const detailLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.trim().length === 0) { j++; continue; }
        if (/^\s*(Planning|Execution)\s+(Time|time)/i.test(nextLine)) break;

        // If the next line is a node line (has cost= or actual time= with an operation),
        // stop collecting details
        if (parseNodeLine(nextLine)) break;

        // It's a detail line — check it belongs to this node (indented further)
        const nextIndent = measureIndent(nextLine);
        if (nextIndent > nodeInfo.indent) {
          detailLines.push(nextLine.trim());
          j++;
        } else {
          break;
        }
      }

      entries.push({ ...nodeInfo, detailLines });
      continue;
    }
  }

  return entries;
}

/**
 * Parse a single line to see if it's a plan node line.
 *
 * PostgreSQL text plan node line examples:
 *   Seq Scan on orders  (cost=0.00..45823.00 rows=125430 width=72)
 *   ->  Hash Join  (cost=45.20..1120.30 rows=2000 width=64)
 *   ->  Index Scan using users_pkey on users u  (cost=0.28..30.00 rows=1000 width=32)
 *   ->  Index Scan using users_pkey on users u  (cost=0.28..30.00 rows=1000 width=32) (actual time=0.010..0.015 rows=1 loops=1000)
 *   Bitmap Heap Scan on users  (cost=4.38..13.60 rows=4 width=44)
 *   Index Only Scan using idx_orders_user on orders  (cost=0.28..5.00 rows=10 width=4)
 *   Nested Loop  (cost=0.00..100.00 rows=1000 width=8)
 *
 * Instead of one giant regex, we:
 * 1. Strip the leading arrow (->)
 * 2. Extract cost/actual parenthetical blocks from the end
 * 3. Parse the remaining text for operation, relation, alias, index
 *
 * @param {string} line
 * @returns {RawNodeEntry|null}
 */
function parseNodeLine(line) {
  // Must contain a cost= or actual time= block to be a node line
  if (!/\(cost=|\(actual\s+time=/i.test(line)) return null;

  const indent = measureIndent(line);

  // Strip leading whitespace and arrow
  let work = line.trimStart();
  if (work.startsWith("->")) {
    work = work.substring(2).trimStart();
  }

  // Extract parenthetical blocks from the right
  // There can be 1 or 2: (cost=...) and optionally (actual time=...)
  // We need to be careful: there might also be things like (never executed)
  const costInfo = extractCostBlock(work);
  const actualInfo = extractActualBlock(work);

  // Remove parenthetical blocks to get the bare operation text
  let bareText = work;
  // Remove all (cost=...) and (actual time=...) blocks
  bareText = bareText.replace(/\(cost=[^)]*\)/g, "").trim();
  bareText = bareText.replace(/\(actual\s+time=[^)]*\)/g, "").trim();
  bareText = bareText.replace(/\(never\s+executed\)/gi, "").trim();

  // Parse the bare text for operation, relation, alias, index
  const parsed = parseOperationText(bareText);

  if (!parsed) return null;

  return {
    indent,
    operation: parsed.operation,
    relation: parsed.relation,
    alias: parsed.alias,
    index: parsed.index,
    costStart: costInfo?.costStart,
    costEnd: costInfo?.costEnd,
    rows: costInfo?.rows,
    width: costInfo?.width,
    actualStartup: actualInfo?.actualStartup,
    actualEnd: actualInfo?.actualEnd,
    actualRows: actualInfo?.actualRows,
    loops: actualInfo?.loops,
    detailLines: [],
  };
}

/**
 * Parse the bare operation text (after removing cost/actual blocks).
 *
 * Common patterns:
 *   "Seq Scan on orders"
 *   "Seq Scan on orders o"
 *   "Index Scan using users_pkey on users u"
 *   "Index Only Scan using idx_foo on bar b"
 *   "Index Only Scan Backward using idx on tbl"
 *   "Bitmap Heap Scan on users"
 *   "Bitmap Index Scan on idx_users_email"
 *   "Nested Loop"
 *   "Nested Loop Left Join"
 *   "Hash Join"
 *   "Merge Join"
 *   "Sort"
 *   "Hash"
 *   "Aggregate"
 *   "GroupAggregate"
 *   "HashAggregate"
 *   "Limit"
 *   "Gather"
 *   "Gather Merge"
 *   "Materialize"
 *   "CTE Scan on cte_name"
 *   "Subquery Scan on subq"
 *   "Append"
 *   "Result"
 *   "Unique"
 *   "WindowAgg"
 *   "SetOp Except"
 *   "Memoize"
 *   "Incremental Sort"
 *
 * @param {string} text
 * @returns {{ operation: string, relation?: string, alias?: string, index?: string } | null}
 */
function parseOperationText(text) {
  if (!text || text.length === 0) return null;

  // Known operation prefixes — ordered longest first to match correctly
  const OPS_WITH_USING_ON = [
    "Parallel Index Only Scan Backward",
    "Parallel Index Only Scan",
    "Parallel Index Scan Backward",
    "Parallel Index Scan",
    "Index Only Scan Backward",
    "Index Only Scan",
    "Index Scan Backward",
    "Index Scan",
  ];

  const OPS_WITH_ON = [
    "Parallel Bitmap Heap Scan",
    "Parallel Seq Scan",
    "Bitmap Heap Scan",
    "Bitmap Index Scan",
    "Seq Scan",
    "Tid Scan",
    "Tid Range Scan",
    "Sample Scan",
    "CTE Scan",
    "Subquery Scan",
    "Foreign Scan",
    "Function Scan",
    "Named Tuplestore Scan",
    "Table Function Scan",
    "Values Scan",
    "WorkTable Scan",
  ];

  const OPS_STANDALONE = [
    "Nested Loop Left Join",
    "Nested Loop Anti Join",
    "Nested Loop Semi Join",
    "Nested Loop",
    "Hash Right Join",
    "Hash Left Join",
    "Hash Anti Join",
    "Hash Semi Join",
    "Hash Full Join",
    "Hash Join",
    "Merge Right Join",
    "Merge Left Join",
    "Merge Anti Join",
    "Merge Semi Join",
    "Merge Full Join",
    "Merge Join",
    "Gather Merge",
    "Gather",
    "Incremental Sort",
    "Sort",
    "HashAggregate",
    "GroupAggregate",
    "MixedAggregate",
    "Aggregate",
    "WindowAgg",
    "Unique",
    "SetOp Except All",
    "SetOp Except",
    "SetOp Intersect All",
    "SetOp Intersect",
    "Limit",
    "Materialize",
    "Memoize",
    "Append",
    "MergeAppend",
    "Recursive Union",
    "BitmapAnd",
    "BitmapOr",
    "Hash",
    "Result",
    "ProjectSet",
    "LockRows",
    "ModifyTable",
  ];

  // ── Try ops with "using <index> on <table> [alias]" ───────────────────
  for (const op of OPS_WITH_USING_ON) {
    if (text.startsWith(op)) {
      const rest = text.substring(op.length).trim();
      // Pattern: "using <index> on <table> [<alias>]"
      const usingMatch = rest.match(/^using\s+(\S+)\s+on\s+(\S+)(?:\s+(\S+))?/i);
      if (usingMatch) {
        return {
          operation: op,
          index: stripQuotes(usingMatch[1]),
          relation: stripQuotes(usingMatch[2]),
          alias: usingMatch[3] ? stripQuotes(usingMatch[3]) : undefined,
        };
      }
      // Might just have "using <index>" without "on <table>"
      const usingOnlyMatch = rest.match(/^using\s+(\S+)/i);
      if (usingOnlyMatch) {
        return {
          operation: op,
          index: stripQuotes(usingOnlyMatch[1]),
        };
      }
      // No "using" — just the operation
      return { operation: op };
    }
  }

  // ── Try ops with "on <relation> [alias]" ──────────────────────────────
  for (const op of OPS_WITH_ON) {
    if (text.startsWith(op)) {
      const rest = text.substring(op.length).trim();
      
      // Bitmap Index Scan uses "on <index_name>" (not a relation)
      if (op === "Bitmap Index Scan") {
        const bitmapMatch = rest.match(/^on\s+(\S+)/i);
        if (bitmapMatch) {
          return {
            operation: op,
            index: stripQuotes(bitmapMatch[1]),
          };
        }
      }

      // Pattern: "on <table> [<alias>]"
      const onMatch = rest.match(/^on\s+(\S+)(?:\s+(\S+))?/i);
      if (onMatch) {
        return {
          operation: op,
          relation: stripQuotes(onMatch[1]),
          alias: onMatch[2] ? stripQuotes(onMatch[2]) : undefined,
        };
      }
      
      return { operation: op };
    }
  }

  // ── Try standalone operations ──────────────────────────────────────────
  for (const op of OPS_STANDALONE) {
    if (text.startsWith(op)) {
      return { operation: op };
    }
  }

  // ── Fallback: use the entire text as the operation name ────────────────
  // This handles any unrecognized node types gracefully
  return { operation: text.trim() };
}

/**
 * Extract cost block: (cost=0.00..45823.00 rows=125430 width=72)
 * @param {string} line
 * @returns {{ costStart: number, costEnd: number, rows: number, width: number } | null}
 */
function extractCostBlock(line) {
  const m = line.match(/\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)/);
  if (!m) return null;
  return {
    costStart: parseFloat(m[1]),
    costEnd: parseFloat(m[2]),
    rows: parseInt(m[3], 10),
    width: parseInt(m[4], 10),
  };
}

/**
 * Extract actual block: (actual time=0.045..42.150 rows=1500 loops=1)
 * @param {string} line
 * @returns {{ actualStartup: number, actualEnd: number, actualRows: number, loops: number } | null}
 */
function extractActualBlock(line) {
  const m = line.match(/\(actual\s+time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\)/);
  if (!m) return null;
  return {
    actualStartup: parseFloat(m[1]),
    actualEnd: parseFloat(m[2]),
    actualRows: parseInt(m[3], 10),
    loops: parseInt(m[4], 10),
  };
}

/**
 * Measure indentation level of a line.
 * Counts leading spaces. Each 2-space indent = 1 depth level.
 * Also accounts for -> arrows: the arrow position determines the depth.
 *
 * @param {string} line
 * @returns {number}
 */
function measureIndent(line) {
  // Count leading spaces
  const match = line.match(/^(\s*)/);
  const spaces = match ? match[1].length : 0;

  // In PostgreSQL text plans, each nesting level is typically 6 spaces
  // (e.g., "      ->  Seq Scan" is 6 spaces for child of root)
  // But the exact number can vary. We use the raw space count for ordering.
  return spaces;
}

/**
 * Build tree from flat node entries using indentation.
 *
 * @param {RawNodeEntry[]} entries
 * @returns {import('../core/types.js').PlanNode}
 */
function buildTree(entries) {
  if (entries.length === 0) return null;

  // Convert each entry to a PlanNode
  const nodes = entries.map(entry => {
    const detailInfo = parseDetailLines(entry.detailLines);

    return {
      indent: entry.indent,
      node: createPlanNode({
        engine: "postgresql",
        operation: entry.operation,
        relation: entry.relation,
        alias: entry.alias,
        index: entry.index,
        estimatedCostStart: entry.costStart,
        estimatedCostTotal: entry.costEnd,
        estimatedRows: entry.rows,
        width: entry.width,
        startupTimeMs: entry.actualStartup,
        inclusiveTimeMs: entry.actualEnd,
        actualRows: entry.actualRows,
        loops: entry.loops,
        ...detailInfo,
        children: [],
      }),
    };
  });

  // Build tree using indentation as depth signal
  // Use a stack to track the current parent at each indentation level
  const root = nodes[0].node;
  root.depth = 0;
  const stack = [{ indent: nodes[0].indent, node: root }];

  for (let i = 1; i < nodes.length; i++) {
    const { indent, node } = nodes[i];

    // Pop stack until we find a parent with lower indentation
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    node.depth = parent.depth + 1;
    parent.children.push(node);
    stack.push({ indent, node });
  }

  return root;
}

/**
 * Parse detail lines (Filter, Sort Key, etc.) into PlanNode fields.
 *
 * @param {string[]} lines
 * @returns {Partial<import('../core/types.js').PlanNode>}
 */
function parseDetailLines(lines) {
  const result = { metadata: {} };

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      // No key-value pair — store in metadata
      result.metadata[line] = true;
      continue;
    }

    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();

    switch (key) {
      case "Filter":
        result.filter = value;
        break;
      case "Index Cond":
        result.indexCondition = value;
        break;
      case "Hash Cond":
      case "Merge Cond":
      case "Join Filter":
        result.joinCondition = value;
        break;
      case "Sort Key":
        result.sortKey = value.split(",").map(s => s.trim());
        break;
      case "Sort Method":
        // "quicksort  Memory: 128kB" — parse both
        result.sortMethod = value;
        const memMatch = value.match(/Memory:\s*([\d.]+)(kB|MB)/i);
        if (memMatch) {
          const size = parseFloat(memMatch[1]);
          result.sortSpaceUsedKb = memMatch[2].toLowerCase() === "mb" ? size * 1024 : size;
          result.sortSpaceType = "Memory";
        }
        const diskMatch = value.match(/Disk:\s*([\d.]+)(kB|MB)/i);
        if (diskMatch) {
          const size = parseFloat(diskMatch[1]);
          result.sortSpaceUsedKb = diskMatch[2].toLowerCase() === "mb" ? size * 1024 : size;
          result.sortSpaceType = "Disk";
        }
        break;
      case "Group Key":
        result.groupKey = value.split(",").map(s => s.trim());
        break;
      case "Rows Removed by Filter":
        result.rowsRemovedByFilter = parseInt(value, 10) || 0;
        break;
      case "Rows Removed by Join Filter":
        result.rowsRemovedByJoinFilter = parseInt(value, 10) || 0;
        break;
      case "Recheck Cond":
        result.metadata["Recheck Cond"] = value;
        break;
      case "Buffers":
        // "shared hit=1234 read=56"
        parseBuffersLine(value, result);
        break;
      case "Heap Fetches":
        result.heapFetches = parseInt(value, 10) || 0;
        break;
      case "Workers Planned":
        result.workersPlanned = parseInt(value, 10) || 0;
        break;
      case "Workers Launched":
        result.workersLaunched = parseInt(value, 10) || 0;
        break;
      case "I/O Timings":
        // "read=1.234 write=0.567"
        const ioRead = value.match(/read=([\d.]+)/);
        if (ioRead) result.ioReadTimeMs = parseFloat(ioRead[1]);
        const ioWrite = value.match(/write=([\d.]+)/);
        if (ioWrite) result.ioWriteTimeMs = parseFloat(ioWrite[1]);
        break;
      case "Peak Memory Usage":
        result.metadata["Peak Memory Usage"] = value;
        break;
      default:
        // Store unknown detail lines in metadata
        result.metadata[key] = value;
        break;
    }
  }

  return result;
}

/**
 * Parse a "Buffers:" detail line.
 * Format: "shared hit=1234 read=56 dirtied=7 written=8, temp read=100 written=200"
 *
 * @param {string} value
 * @param {Object} result — mutated in place
 */
function parseBuffersLine(value, result) {
  const sharedHit = value.match(/shared\s+hit=(\d+)/);
  if (sharedHit) result.sharedHitBlocks = parseInt(sharedHit[1], 10);

  const sharedRead = value.match(/shared\s+(?:hit=\d+\s+)?read=(\d+)/);
  if (sharedRead) result.sharedReadBlocks = parseInt(sharedRead[1], 10);
  // Also try just "read=N" after "shared"
  if (!sharedRead) {
    const altRead = value.match(/read=(\d+)/);
    if (altRead && value.includes("shared")) result.sharedReadBlocks = parseInt(altRead[1], 10);
  }

  const sharedDirtied = value.match(/dirtied=(\d+)/);
  if (sharedDirtied) result.sharedDirtiedBlocks = parseInt(sharedDirtied[1], 10);

  const sharedWritten = value.match(/shared\s+.*written=(\d+)/);
  if (sharedWritten) result.sharedWrittenBlocks = parseInt(sharedWritten[1], 10);

  const tempRead = value.match(/temp\s+read=(\d+)/);
  if (tempRead) result.tempReadBlocks = parseInt(tempRead[1], 10);

  const tempWritten = value.match(/temp\s+.*written=(\d+)/);
  if (tempWritten) result.tempWrittenBlocks = parseInt(tempWritten[1], 10);
}

/**
 * Remove surrounding double quotes from an identifier.
 * @param {string} s
 * @returns {string}
 */
function stripQuotes(s) {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}
