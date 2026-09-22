// src/analysis/rules/rows-removed.js
// Browser-compatible ES module

import { computeDiscardRatio } from "../../core/metrics.js";

export function analyzeRowsRemoved(node, formatLargeNumber) {
  const findings = [];
  
  if (node.rowsRemovedByFilter > 0 || node.rowsRemovedByJoinFilter > 0) {
    const removed = (node.rowsRemovedByFilter || 0) + (node.rowsRemovedByJoinFilter || 0);
    const returned = node.actualRows || node.estimatedRows || 0;
    const { examined, discardRatio, label } = computeDiscardRatio(returned, removed);
    
    if (discardRatio > 0.8 && examined > 1000) {
      findings.push({
        id: `rows-removed-${node.id}`,
        severity: "high",
        confidence: node.actualRows != null ? "high" : "medium",
        category: "filtering",
        title: `High Filter Discard Rate`,
        summary: `Almost ${label} after reading them.`,
        evidence: [
          { label: "Rows Examined", value: formatLargeNumber(examined) },
          { label: "Rows Removed", value: formatLargeNumber(removed) },
          { label: "Rows Kept", value: formatLargeNumber(returned) }
        ],
        recommendation: `Check whether an appropriate index exists for the filter condition. An index may reduce the number of rows the database needs to examine.`,
        nodeIds: [node.id]
      });
    }
  }
  
  return findings;
}
