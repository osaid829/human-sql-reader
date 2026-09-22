// src/analysis/rules/estimate-mismatch.js
// Browser-compatible ES module

import { computeEstimateRatio } from "../../core/metrics.js";

export function analyzeEstimateMismatch(node, formatLargeNumber) {
  const findings = [];
  
  if (node.estimatedRows != null && node.actualRows != null) {
    const { ratio, direction, label } = computeEstimateRatio(node.estimatedRows, node.actualRows);
    
    // Only flag if the mismatch is severe (e.g., > 10x off) and the absolute difference is significant
    const absDiff = Math.abs(node.estimatedRows - node.actualRows);
    
    if ((ratio > 10 || ratio < 0.1) && absDiff > 1000) {
      findings.push({
        id: `estimate-mismatch-${node.id}`,
        severity: "medium",
        confidence: "high",
        category: "statistics",
        title: `Severe Row Estimation Error`,
        summary: `The query planner expected ${formatLargeNumber(node.estimatedRows)} rows but actually found ${formatLargeNumber(node.actualRows)}.`,
        evidence: [
          { label: "Estimated Rows", value: formatLargeNumber(node.estimatedRows) },
          { label: "Actual Rows", value: formatLargeNumber(node.actualRows) },
          { label: "Mismatch", value: label }
        ],
        recommendation: `Severe estimation errors can lead to poor join choices or bad memory allocation. Consider running ANALYZE on the involved tables to update statistics.`,
        nodeIds: [node.id]
      });
    }
  }
  
  return findings;
}
