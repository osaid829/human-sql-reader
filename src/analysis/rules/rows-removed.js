// src/analysis/rules/rows-removed.js
// Browser-compatible ES module

import { computeDiscardRatio } from "../../core/metrics.js";

export function analyzeRowsRemoved(node, formatLargeNumber) {
  const findings = [];

  const rowsRemovedByFilter = node.rowsRemovedByFilter || 0;
  const rowsRemovedByJoinFilter = node.rowsRemovedByJoinFilter || 0;
  const removed = rowsRemovedByFilter + rowsRemovedByJoinFilter;

  if (removed <= 0) {
    return findings;
  }

  /*
   * Rows Removed by Filter / Join Filter is an execution metric.
   *
   * Only combine it with actualRows when calculating an examined-row count
   * or discard ratio. estimatedRows is a planner estimate and must never be
   * substituted for actualRows here.
   */
  if (node.actualRows != null) {
    const actualRows = node.actualRows;
    const {
      examined,
      discardRatio,
      label,
    } = computeDiscardRatio(actualRows, removed);

    if (discardRatio > 0.8 && examined > 1000) {
      findings.push({
        id: `rows-removed-${node.id}`,
        severity: "high",
        confidence: "high",
        category: "filtering",
        title: "High Filter Discard Rate",
        summary: `${label}.`,
        evidence: [
          {
            label: "Rows Examined",
            value: formatLargeNumber(examined),
          },
          {
            label: "Actual Rows Returned",
            value: formatLargeNumber(actualRows),
          },
          {
            label: "Rows Removed",
            value: formatLargeNumber(removed),
          },
          {
            label: "Discard Ratio",
            value: `${(discardRatio * 100).toFixed(1)}%`,
          },
        ],
        recommendation:
          "A large portion of examined rows is being discarded. " +
          "Check whether an appropriate index exists for the filter or join " +
          "condition and whether its selectivity makes index access useful.",
        nodeIds: [node.id],
      });
    }

    return findings;
  }

  /*
   * We have rows-removed data but no actual output-row count.
   * Do not invent examined rows or a discard percentage.
   */
  if (removed > 1000) {
    const evidence = [
      {
        label: "Rows Removed",
        value: formatLargeNumber(removed),
      },
    ];

    if (node.estimatedRows != null) {
      evidence.unshift({
        label: "Estimated Rows",
        value: formatLargeNumber(node.estimatedRows),
      });
    }

    findings.push({
      id: `rows-removed-${node.id}`,
      severity: removed > 10000 ? "high" : "medium",
      confidence: "medium",
      category: "filtering",
      title: "Large Number of Rows Removed by Filter",
      summary:
        `The plan reports ${formatLargeNumber(removed)} rows removed by ` +
        `filtering. Actual returned-row counts are unavailable, so an exact ` +
        `discard ratio cannot be calculated.`,
      evidence,
      recommendation:
        "The filter is doing substantial work. Use EXPLAIN ANALYZE to compare " +
        "actual rows returned with rows removed, and investigate whether an " +
        "appropriate selective index could reduce the work.",
      nodeIds: [node.id],
    });
  }

  return findings;
}
