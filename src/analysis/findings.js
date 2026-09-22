// src/analysis/findings.js
// Browser-compatible ES module

import { formatLargeNumber } from "../core/metrics.js";
import { analyzeSequentialScans } from "./rules/sequential-scans.js";
import { analyzeEstimateMismatch } from "./rules/estimate-mismatch.js";
import { analyzeRowsRemoved } from "./rules/rows-removed.js";
import { analyzeNestedLoop } from "./rules/nested-loop.js";
import { analyzeSorting } from "./rules/sorting.js";
import { analyzeIoBuffers } from "./rules/io-buffers.js";
import { analyzeParallel } from "./rules/parallel.js";

/**
 * Generate findings by applying rules to the PlanNode tree.
 * @param {import('../core/types.js').PlanNode[]} flatNodes 
 * @returns {import('../core/types.js').Finding[]}
 */
export function generateFindings(flatNodes) {
  const allFindings = [];

  for (const node of flatNodes) {
    allFindings.push(...analyzeSequentialScans(node, formatLargeNumber));
    allFindings.push(...analyzeEstimateMismatch(node, formatLargeNumber));
    allFindings.push(...analyzeRowsRemoved(node, formatLargeNumber));
    allFindings.push(...analyzeNestedLoop(node, formatLargeNumber));
    allFindings.push(...analyzeSorting(node, formatLargeNumber));
    allFindings.push(...analyzeIoBuffers(node, formatLargeNumber));
    allFindings.push(...analyzeParallel(node, formatLargeNumber));
  }

  return consolidateFindings(allFindings);
}

function consolidateFindings(findings) {
  // Deduplicate by ID and sort by severity
  const uniqueMap = new Map();
  for (const f of findings) {
    uniqueMap.set(f.id, f);
  }
  
  const result = Array.from(uniqueMap.values());
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4, warning: 1, good: 5 };
  
  result.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return result;
}
