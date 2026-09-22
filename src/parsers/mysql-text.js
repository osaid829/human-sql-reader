// src/parsers/mysql-text.js — MySQL tabular + TREE EXPLAIN parser
// Browser-compatible ES module

import { createPlanNode, resetNodeIds } from "../core/types.js";

/**
 * Parse MySQL tabular EXPLAIN output into a PlanNode tree.
 *
 * Handles both pipe-delimited and whitespace-delimited formats:
 *   | id | select_type | table | type | ...
 *   id  select_type  table  type  ...
 *
 * @param {string} text — raw plan text
 * @returns {{ tree: import('../core/types.js').PlanNode|null, error?: string }}
 */
export function parseMysqlText(text) {
  resetNodeIds();

  const lines = text.split("\n").filter(l => l.trim().length > 0);

  // Find the header line
  let headerIdx = -1;
  let sep = "pipe";
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/\btype\b/i.test(t) && /\btable\b/i.test(t)) {
      headerIdx = i;
      sep = t.startsWith("|") ? "pipe" : "tab";
      break;
    }
  }

  if (headerIdx === -1) {
    return { tree: null, error: "Could not find MySQL EXPLAIN table header (expected columns: type, table)." };
  }

  const splitRow = (line) => {
    if (sep === "pipe") {
      return line
        .split("|")
        .map(c => c.trim())
        .filter(c => c.length > 0);
    }
    return line.split(/\t+|\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
  };

  const headers = splitRow(lines[headerIdx]).map(h => h.toLowerCase());

  const col = (row, name) => {
    const idx = headers.indexOf(name);
    return idx >= 0 && idx < row.length ? row[idx] : null;
  };

  const tableNodes = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("+") || t.length === 0) continue; // separator
    const cells = splitRow(lines[i]);
    if (cells.length < 3) continue;

    const accessType = col(cells, "type") ?? "unknown";
    const table = col(cells, "table");
    const possibleKeys = col(cells, "possible_keys");
    const key = col(cells, "key");
    const keyLen = col(cells, "key_len");
    const ref = col(cells, "ref");
    const rowsEst = parseInt(col(cells, "rows") ?? "0", 10) || 0;
    const filtered = parseFloat(col(cells, "filtered") ?? "100") || 100;
    const extra = col(cells, "extra") ?? "";
    const selectType = col(cells, "select_type") ?? "";
    const partitions = col(cells, "partitions");

    // Map access type to operation name
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

    const node = createPlanNode({
      engine: "mysql",
      operation,
      relation: (table && table !== "NULL") ? table : undefined,
      index: (key && key !== "NULL") ? key : undefined,
      estimatedRows: rowsEst,

      filter: undefined, // MySQL tabular doesn't have a direct filter column

      metadata: {
        accessType,
        selectType,
        possibleKeys: (possibleKeys && possibleKeys !== "NULL") ? possibleKeys : undefined,
        keyLength: (keyLen && keyLen !== "NULL") ? keyLen : undefined,
        ref: (ref && ref !== "NULL") ? ref : undefined,
        filtered,
        extra,
        partitions: (partitions && partitions !== "NULL") ? partitions : undefined,
        using_filesort: /filesort/i.test(extra),
        using_temporary_table: /temporary/i.test(extra),
        using_where: /Using where/i.test(extra),
        using_index: /Using index(?!\s+condition)/i.test(extra),
        using_index_condition: /Using index condition/i.test(extra),
      },
    });

    tableNodes.push(node);
  }

  if (tableNodes.length === 0) {
    return { tree: null, error: "No data rows found in MySQL EXPLAIN output." };
  }

  // If multiple tables, wrap in a Nested Loop (MySQL tabular doesn't show explicit join structure)
  if (tableNodes.length === 1) {
    return { tree: tableNodes[0] };
  }

  const tree = createPlanNode({
    engine: "mysql",
    operation: "Nested Loop",
    children: tableNodes,
  });

  return { tree };
}

// ─────────────────────────────────────────────────────────────────────────────
// MySQL TREE / EXPLAIN ANALYZE format
// Example:
//   -> Sort: <temporary>.yes  (cost=1043.21 rows=99) (actual time=7.553..7.553 rows=99 loops=1)
//       -> Nested loop inner join  (cost=2.50..1011.99 rows=99) (actual time=0.031..7.553 rows=99 loops=1)
//           -> Table scan on t2  (cost=0.02..2.16 rows=288) (actual time=0.018..0.070 rows=288 loops=1)
//           -> Index lookup on t1 using PRIMARY (t1.a=t2.a)  (cost=0.70..0.94 rows=1) (actual time=0.036..0.039 rows=1 loops=1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a MySQL EXPLAIN ANALYZE / FORMAT=TREE plan into a PlanNode tree.
 * @param {string} text — raw plan text
 * @returns {{ tree: import('../core/types.js').PlanNode|null, error?: string }}
 */
export function parseMysqlTree(text) {
  resetNodeIds();

  const entries = [];
  for (const line of text.split("\n")) {
    // Node lines always begin with an optional indent + "->"
    if (!/^\s*->\s+/.test(line)) continue;

    const indent = measureIndent(line);
    let work = line.replace(/^\s*->\s+/, "").trim();

    const costInfo = extractMysqlCostBlock(work);
    const actualInfo = extractMysqlActualBlock(work);

    // Remove parenthetical metrics to get the bare operation text
    work = work
      .replace(/\(cost=[^)]*\)/g, "")
      .replace(/\(actual\s+time=[^)]*\)/g, "")
      .trim();

    const parsed = parseMysqlTreeOp(work);
    if (!parsed) continue;

    entries.push({
      indent,
      operation: parsed.operation,
      relation: parsed.relation,
      index: parsed.index,
      accessType: parsed.accessType,
      filter: parsed.filter,
      costStart: costInfo?.costStart,
      costEnd: costInfo?.costEnd,
      rows: costInfo?.rows,
      startupTimeMs: actualInfo?.actualStartup,
      inclusiveTimeMs: actualInfo?.actualEnd,
      actualRows: actualInfo?.actualRows,
      loops: actualInfo?.loops,
    });
  }

  if (entries.length === 0) {
    return { tree: null, error: "Could not find any MySQL TREE nodes (expected lines starting with '->')." };
  }

  // Build node wrappers, then attach children by indentation depth
  const nodes = entries.map(e => ({
    indent: e.indent,
    node: createPlanNode({
      engine: "mysql",
      operation: e.operation,
      relation: e.relation,
      index: e.index,
      filter: e.filter,
      estimatedCostStart: e.costStart,
      estimatedCostTotal: e.costEnd != null ? e.costEnd : e.costStart,
      estimatedRows: e.rows,
      startupTimeMs: e.startupTimeMs,
      inclusiveTimeMs: e.inclusiveTimeMs,
      actualRows: e.actualRows,
      loops: e.loops,
      metadata: e.accessType ? { accessType: e.accessType } : {},
      children: [],
    }),
  }));

  const root = nodes[0].node;
  root.depth = 0;
  const stack = [{ indent: nodes[0].indent, node: root }];

  for (let i = 1; i < nodes.length; i++) {
    const { indent, node } = nodes[i];

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].node;
    node.depth = parent.depth + 1;
    parent.children.push(node);
    stack.push({ indent, node });
  }

  return { tree: root };
}

/**
 * Parse the bare operation text of a MySQL TREE line.
 * @param {string} text
 * @returns {{ operation: string, relation?: string, index?: string, accessType?: string, filter?: string } | null}
 */
function parseMysqlTreeOp(text) {
  if (!text || text.length === 0) return null;

  let m = text.match(/^Filter:\s*(.*)$/i);
  if (m) return { operation: "Filter", filter: m[1] };

  if (/^Sort:/i.test(text)) return { operation: "Filesort" };
  if (/^Group by:/i.test(text)) return { operation: "Group" };
  if (/^Aggregate:/i.test(text)) return { operation: "Aggregate" };

  m = text.match(/^Table scan on\s+(\S+)/i);
  if (m) return { operation: "Full Table Scan", relation: stripQuotes(m[1]), accessType: "ALL" };

  m = text.match(/^Unique index lookup on\s+(\S+)(?:\s+using\s+(\S+))?/i);
  if (m) {
    return {
      operation: "Unique Index Lookup (eq_ref)",
      relation: stripQuotes(m[1]),
      index: m[2] ? stripQuotes(m[2]) : undefined,
      accessType: "eq_ref",
    };
  }

  m = text.match(/^Index lookup on\s+(\S+)(?:\s+using\s+(\S+))?/i);
  if (m) {
    return {
      operation: "Index Lookup (ref)",
      relation: stripQuotes(m[1]),
      index: m[2] ? stripQuotes(m[2]) : undefined,
      accessType: "ref",
    };
  }

  m = text.match(/^Index range scan on\s+(\S+)(?:\s+using\s+(\S+))?/i);
  if (m) {
    return {
      operation: "Index Range Scan",
      relation: stripQuotes(m[1]),
      index: m[2] ? stripQuotes(m[2]) : undefined,
      accessType: "range",
    };
  }

  if (/^Covering index lookup/i.test(text)) {
    m = text.match(/^Covering index lookup on\s+(\S+)(?:\s+using\s+(\S+))?/i);
    return {
      operation: "Index Lookup (ref)",
      relation: m ? stripQuotes(m[1]) : undefined,
      index: m && m[2] ? stripQuotes(m[2]) : undefined,
      accessType: "ref",
    };
  }
  if (/^Covering index scan/i.test(text)) {
    m = text.match(/^Covering index scan on\s+(\S+)/i);
    return { operation: "Full Index Scan", relation: m ? stripQuotes(m[1]) : undefined, accessType: "index" };
  }

  if (/^Index merge/i.test(text)) return { operation: "Index Merge", accessType: "index_merge" };

  if (/^Nested loop/i.test(text)) return { operation: "Nested Loop" };

  if (/hash join/i.test(text)) return { operation: "Hash Join" };

  if (/^Duplicate rows removal/i.test(text)) return { operation: "Duplicates Removal" };
  if (/^Full scan on NULL key/i.test(text)) return { operation: "Full Table Scan", accessType: "ALL" };
  if (/^Materialize/i.test(text)) return { operation: "Materialize" };
  if (/^Temporary table/i.test(text)) return { operation: "Temporary Table" };
  if (/^Union/i.test(text)) return { operation: "Union" };
  if (/^Subquery/i.test(text)) return { operation: "Subquery" };
  if (/^Update/i.test(text)) return { operation: "Update" };
  if (/^Delete/i.test(text)) return { operation: "Delete" };
  if (/^Insert/i.test(text)) return { operation: "Insert" };

  return { operation: text };
}

/**
 * Extract a MySQL TREE cost block: (cost=1.75..1043.21 rows=99) or (cost=1.23 rows=456)
 * @param {string} line
 * @returns {{ costStart: number, costEnd?: number, rows: number } | null}
 */
function extractMysqlCostBlock(line) {
  const m = line.match(/\(cost=([\d.]+)(?:\.\.([\d.]+))?\s+rows=(\d+)\)/);
  if (!m) return null;
  return {
    costStart: parseFloat(m[1]),
    costEnd: m[2] != null ? parseFloat(m[2]) : undefined,
    rows: parseInt(m[3], 10),
  };
}

/**
 * Extract a MySQL TREE actual block: (actual time=0.018..0.070 rows=288 loops=1)
 * @param {string} line
 * @returns {{ actualStartup: number, actualEnd: number, actualRows: number, loops: number } | null}
 */
function extractMysqlActualBlock(line) {
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
 * Measure indentation level of a line (counts leading spaces).
 * @param {string} line
 * @returns {number}
 */
function measureIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
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
