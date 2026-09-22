// src/core/detect-format.js — Detect plan format and engine
// Browser-compatible ES module

/**
 * Detect the engine (PostgreSQL/MySQL) and format of a raw plan string.
 *
 * @param {string} raw — raw plan text
 * @returns {{ engine: string, format: string, confidence: string }}
 */
export function detectFormat(raw) {
  const trimmed = raw.trim();

  // ── Try JSON parse first ──────────────────────────────────────────────────
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return detectJsonFormat(parsed);
    } catch {
      // Not valid JSON — fall through
    }
  }

  // ── Text-based detection ──────────────────────────────────────────────────
  return detectTextFormat(trimmed);
}

/**
 * Detect format from a parsed JSON object.
 * @param {any} parsed
 * @returns {{ engine: string, format: string, confidence: string }}
 */
function detectJsonFormat(parsed) {
  // PostgreSQL: [{ "Plan": { "Node Type": ... } }]
  const wrapper = Array.isArray(parsed) ? parsed[0] : parsed;

  if (wrapper && typeof wrapper === "object") {
    // PostgreSQL JSON EXPLAIN
    if (wrapper.Plan && wrapper.Plan["Node Type"]) {
      return { engine: "postgresql", format: "json", confidence: "high" };
    }
    // Just a Plan node directly?
    if (wrapper["Node Type"]) {
      return { engine: "postgresql", format: "json", confidence: "high" };
    }

    // MySQL JSON EXPLAIN
    if (wrapper.query_block) {
      return { engine: "mysql", format: "json", confidence: "high" };
    }

    // MySQL JSON — might have nested_loop, ordering_operation etc.
    if (wrapper.nested_loop || wrapper.ordering_operation || wrapper.table) {
      return { engine: "mysql", format: "json", confidence: "medium" };
    }
  }

  return { engine: "unknown", format: "json", confidence: "low" };
}

/**
 * Detect format from text content.
 * @param {string} text
 * @returns {{ engine: string, format: string, confidence: string }}
 */
function detectTextFormat(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    return { engine: "unknown", format: "unknown", confidence: "low" };
  }

// ── PostgreSQL text format ──────────────────────────────────────────────
  // Look for PostgreSQL cost= or actual time= patterns
  const pgCostPattern = /\(cost=[\d.]+\.\.[\d.]+\s+rows=\d+/;
  const pgActualPattern = /\(actual\s+time=[\d.]+\.\.[\d.]+\s+rows=\d+/;
  const pgNodePatterns = [
    /Seq Scan/i, /Index Scan/i, /Index Only Scan/i,
    /Bitmap Heap Scan/i, /Bitmap Index Scan/i,
    /Nested Loop/i, /Hash Join/i, /Merge Join/i,
    /Sort\b/i, /Aggregate/i, /Hash\b/i,
    /Gather\b/i, /Limit\b/i, /Materialize/i,
    /CTE Scan/i, /Subquery Scan/i, /Append/i,
  ];

  const hasPgCost = lines.some(l => pgCostPattern.test(l));
  const hasPgActual = lines.some(l => pgActualPattern.test(l));
  const hasPgNodes = lines.some(l => pgNodePatterns.some(p => p.test(l)));

  // ── MySQL TREE / EXPLAIN ANALYZE format ─────────────────────────────────
  // MySQL FORMAT=TREE / EXPLAIN ANALYZE prints each operation on a line that
  // begins with "->" (children are indented). Use case-sensitive operation
  // keywords anchored to the arrow lines so PostgreSQL plans (which contain
  // "Nested Loop", "Filter:", and indented "->" lines of their own) are never
  // mistaken for MySQL TREE output.
  const mysqlTreeOps = [
    "Table scan on", "Index lookup on", "Nested loop",
    "Covering index", "Index range scan", "Unique index lookup",
    "Inner hash join", "Block NL join", "Index merge",
    "Filter:", "Sort:", "Group by:", "Aggregate:",
    "Group aggregate", "Hash aggregate",
    "Duplicate rows removal", "Temporary table", "Materialize",
    "Full scan on NULL key", "Backward index scan",
  ];
  const hasMysqlTreeOp = line => mysqlTreeOps.some(op => line.includes(op));
  const mysqlTreePattern = /^\s*->\s+/;
  const mysqlTreeLines = lines.filter(l => mysqlTreePattern.test(l) && hasMysqlTreeOp(l));
  if (mysqlTreeLines.length > 0) {
    return { engine: "mysql", format: "tree", confidence: "high" };
  }

  // ── PostgreSQL takes priority if cost block is clearly present ────────
  if (hasPgCost || hasPgActual) {
    return { engine: "postgresql", format: "text", confidence: "high" };
  }

  // ── MySQL tabular format ───────────────────────────────────────────────
  const hasTableHeader = lines.some(l =>
    /\btype\b/i.test(l) && /\btable\b/i.test(l) && (/\bkey\b/i.test(l) || /\brows\b/i.test(l))
  );
  const hasPipeSeparator = lines.some(l => l.startsWith("|") || l.startsWith("+--"));
  if (hasTableHeader) {
    return {
      engine: "mysql",
      format: "tabular",
      confidence: hasPipeSeparator ? "high" : "medium"
    };
  }

  if (hasPgNodes) {
    return { engine: "postgresql", format: "text", confidence: "medium" };
  }

  // ── Could not determine ────────────────────────────────────────────────
  return { engine: "unknown", format: "unknown", confidence: "low" };
}
