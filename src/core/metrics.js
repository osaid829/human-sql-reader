// src/core/metrics.js — Compute derived metrics from PlanNode trees
// Browser-compatible ES module

/**
 * Compute exclusive (approximate self) time for every node in the tree.
 * exclusiveTimeApprox = inclusiveTime - sum(child inclusive contributions)
 *
 * For nodes with loops, we use per-loop times for the subtraction.
 * This is approximate because PostgreSQL timing has instrumentation overhead
 * and parallel workers make attribution imprecise.
 *
 * @param {import('./types.js').PlanNode} root
 */
export function computeExclusiveTimes(root) {
  function walk(node) {
    // Process children first (bottom-up)
    for (const child of node.children) {
      walk(child);
    }

    if (node.inclusiveTimeMs == null) {
      node.exclusiveTimeMsApprox = undefined;
      return;
    }

    // Sum of child inclusive contributions
    // Each child's inclusiveTimeMs is per-loop. The child ran child.loops times.
    // But the parent's inclusiveTimeMs is also per-loop (per parent loop).
    // So: child contribution to parent per-parent-loop = child.inclusiveTimeMs * child.loops / parent.loops
    const parentLoops = node.loops || 1;
    let childContribution = 0;

    for (const child of node.children) {
      if (child.inclusiveTimeMs != null) {
        const childLoops = child.loops || 1;
        // Child runs childLoops times total. Per parent loop, child runs childLoops/parentLoops times.
        childContribution += child.inclusiveTimeMs * (childLoops / parentLoops);
      }
    }

    const exclusive = node.inclusiveTimeMs - childContribution;
    // Clamp to 0 — instrumentation noise can make this slightly negative
    node.exclusiveTimeMsApprox = Math.max(0, exclusive);
  }

  walk(root);
}

/**
 * Compute total approximate rows (actualRows * loops) for each node.
 * Also compute actualRowsPerLoop for display purposes.
 *
 * @param {import('./types.js').PlanNode} root
 */
export function computeRowMetrics(root) {
  function walk(node) {
    const loops = node.loops || 1;

    if (node.actualRows != null) {
      node.actualRowsPerLoop = node.actualRows;
      node.totalRowsApprox = node.actualRows * loops;
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
}

/**
 * Compute the estimate-to-actual ratio for row counts.
 * Returns the ratio and a human-readable description.
 *
 * A ratio of 1.0 means perfect estimate.
 * A ratio > 1 means more actual rows than estimated (underestimate).
 * A ratio < 1 means fewer actual rows than estimated (overestimate).
 *
 * @param {number} estimated
 * @param {number} actual
 * @returns {{ ratio: number, direction: 'accurate'|'underestimate'|'overestimate', label: string }}
 */
export function computeEstimateRatio(estimated, actual) {
  if (estimated === 0 && actual === 0) {
    return { ratio: 1, direction: "accurate", label: "Both zero" };
  }
  if (estimated === 0) {
    return { ratio: Infinity, direction: "underestimate", label: `Expected 0, got ${actual.toLocaleString()}` };
  }
  if (actual === 0) {
    return { ratio: 0, direction: "overestimate", label: `Expected ${estimated.toLocaleString()}, got 0` };
  }

  const ratio = actual / estimated;

  if (ratio >= 0.5 && ratio <= 2.0) {
    return { ratio, direction: "accurate", label: `${ratio.toFixed(1)}x (reasonable)` };
  } else if (ratio > 2.0) {
    return { ratio, direction: "underestimate", label: `${ratio.toFixed(1)}x more rows than expected` };
  } else {
    return { ratio, direction: "overestimate", label: `${(1 / ratio).toFixed(1)}x fewer rows than expected` };
  }
}

/**
 * Compute the discard ratio: how many rows were examined but removed.
 *
 * @param {number} rowsReturned — rows that survived filtering
 * @param {number} rowsRemoved — rows removed by filter
 * @returns {{ examined: number, returned: number, discarded: number, discardRatio: number, label: string }}
 */
export function computeDiscardRatio(rowsReturned, rowsRemoved) {
  const examined = rowsReturned + rowsRemoved;
  if (examined === 0) {
    return { examined: 0, returned: 0, discarded: 0, discardRatio: 0, label: "No rows examined" };
  }
  const discardRatio = rowsRemoved / examined;
  const pct = (discardRatio * 100).toFixed(1);
  return {
    examined,
    returned: rowsReturned,
    discarded: rowsRemoved,
    discardRatio,
    label: `${pct}% of examined rows were discarded`,
  };
}

/**
 * Find the node with the highest exclusive time (approximate bottleneck).
 * Falls back to highest inclusive time, then highest cost.
 *
 * @param {import('./types.js').PlanNode[]} flatNodes
 * @returns {import('./types.js').PlanNode|null}
 */
export function findBottleneckNode(flatNodes) {
  if (flatNodes.length === 0) return null;

  // Prefer exclusive time
  const withExclusive = flatNodes.filter(n => n.exclusiveTimeMsApprox != null && n.exclusiveTimeMsApprox > 0);
  if (withExclusive.length > 0) {
    return withExclusive.reduce((max, n) =>
      n.exclusiveTimeMsApprox > max.exclusiveTimeMsApprox ? n : max
    );
  }

  // Fall back to inclusive time
  const withInclusive = flatNodes.filter(n => n.inclusiveTimeMs != null && n.inclusiveTimeMs > 0);
  if (withInclusive.length > 0) {
    return withInclusive.reduce((max, n) =>
      n.inclusiveTimeMs > max.inclusiveTimeMs ? n : max
    );
  }

  // Fall back to cost
  const withCost = flatNodes.filter(n => n.estimatedCostTotal != null && n.estimatedCostTotal > 0);
  if (withCost.length > 0) {
    return withCost.reduce((max, n) =>
      n.estimatedCostTotal > max.estimatedCostTotal ? n : max
    );
  }

  return flatNodes[0];
}

/**
 * Format a large number for display (e.g., 985000 → "985K").
 * @param {number} n
 * @returns {string}
 */
export function formatLargeNumber(n) {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

/**
 * Format milliseconds for display.
 * @param {number} ms
 * @returns {string}
 */
export function formatMs(ms) {
  if (ms == null) return "—";
  if (ms >= 1000) return (ms / 1000).toFixed(2) + " s";
  if (ms >= 1) return ms.toFixed(2) + " ms";
  return (ms * 1000).toFixed(0) + " µs";
}
