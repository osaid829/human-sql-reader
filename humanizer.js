// humanizer.js — Parses and translates SQL EXPLAIN plans into plain English
// Main entry point

import { detectFormat } from "./src/core/detect-format.js";
import { flattenTree } from "./src/core/types.js";
import { computeExclusiveTimes, computeRowMetrics, findBottleneckNode } from "./src/core/metrics.js";
import { parsePostgresJson } from "./src/parsers/postgres-json.js";
import { parsePostgresText } from "./src/parsers/postgres-text.js";
import { parseMysqlJson } from "./src/parsers/mysql-json.js";
import { parseMysqlText, parseMysqlTree } from "./src/parsers/mysql-text.js";
import { generateFindings } from "./src/analysis/findings.js";
import { getExplanation, buildStory } from "./src/explanations/humanize.js";

/**
 * Main entry point: takes raw EXPLAIN text and dialect, returns structured analysis.
 */
export function humanizeExplain(rawText, dialectHint = "postgres") {
  // 1. Detect format
  const detection = detectFormat(rawText);
  let engine = detection.engine;
  let format = detection.format;
  
  if (engine === "unknown") {
      // Fallback to hint
      engine = dialectHint === "mysql" ? "mysql" : "postgresql";
      // Try to guess format from first char
      const trimmed = rawText.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          format = "json";
      } else {
          format = engine === "mysql" ? "tabular" : "text";
      }
  }

  // 2. Parse
  let parseResult;
  if (engine === "postgresql") {
      if (format === "json") {
          try {
              parseResult = parsePostgresJson(JSON.parse(rawText));
          } catch {
              return buildFallbackAnalysis(rawText, engine, "Malformed JSON input");
          }
      } else {
          parseResult = parsePostgresText(rawText);
      }
  } else {
       if (format === "json") {
          try {
              parseResult = parseMysqlJson(JSON.parse(rawText));
          } catch {
              return buildFallbackAnalysis(rawText, engine, "Malformed JSON input");
          }
      } else if (format === "tree") {
          parseResult = parseMysqlTree(rawText);
      } else {
          parseResult = parseMysqlText(rawText);
      }
  }

  if (!parseResult.tree) {
      return buildFallbackAnalysis(rawText, engine, parseResult.error);
  }

  // 3. Compute Metrics
  computeExclusiveTimes(parseResult.tree);
  computeRowMetrics(parseResult.tree);
  
  const flatNodes = flattenTree(parseResult.tree);
  const bottleneck = findBottleneckNode(flatNodes);
  const findings = generateFindings(flatNodes);

  // 4. Build output
  const hasActualMetrics = flatNodes.some(n => n.inclusiveTimeMs != null || n.actualRows != null);
  
  // Format legacy steps structure for UI compatibility (Phase 1)
  const steps = flatNodes.map(node => {
      const expl = getExplanation(node, "developer");
      
      const details = [];
      if (node.filter) details.push(`Filter: ${node.filter}`);
      if (node.indexCondition) details.push(`Index Cond: ${node.indexCondition}`);
      if (node.joinCondition) details.push(`Join Cond: ${node.joinCondition}`);
      if (node.rowsRemovedByFilter) details.push(`Rows Removed by Filter: ${node.rowsRemovedByFilter}`);

      return {
          id: node.id,
          type: node.operation,
          operation: node.operation,
          metadata: node.metadata,
          relation: node.relation,
          index: node.index,
          target: node.relation || node.index || null,
          cost: node.estimatedCostTotal || 0,
          rowsEst: node.estimatedRows || 0,
          actualTime: node.inclusiveTimeMs !== undefined ? node.inclusiveTimeMs : null,
          actualRows: node.actualRows !== undefined ? node.actualRows : null,
          loops: node.loops || 1,
          exclusiveTimeMsApprox: node.exclusiveTimeMsApprox,
          inclusiveTimeMs: node.inclusiveTimeMs,
          estimatedCostTotal: node.estimatedCostTotal,
          estimatedRows: node.estimatedRows,
          details: details,
          label: expl.label,
          severity: "info", // Can map from category if needed
          summary: expl.summary,
          tip: expl.tip,
          raw: node.operation,
          node: node
      };
  });
  
  let verdictType = findings.some(f => f.severity === "high" || f.severity === "critical") ? "warning" : "good";
  let verdictTitle = findings.length > 0 ? "Issues Detected" : "Query looks reasonable";

  const result = {
    engine: engine,
    hasActual: hasActualMetrics,
    totalCost: parseResult.queryCost || parseResult.tree.estimatedCostTotal || 0,
    totalTime: parseResult.executionTimeMs || parseResult.tree.inclusiveTimeMs || null,
    stepCount: flatNodes.length,
    verdictTitle,
    verdictType,
    story: "", // Will be filled
    bottleneck: bottleneck ? steps.find(s => s.id === bottleneck.id) : null,
    issues: findings,
    steps,
    tree: parseResult.tree,
    flatNodes
  };

  result.story = buildStory(result);

  return result;
}

function buildFallbackAnalysis(rawText, engine, errorMsg) {
  return {
    engine: engine,
    hasActual: false,
    totalCost: 0,
    totalTime: null,
    stepCount: 0,
    verdictTitle: "Could Not Parse Plan",
    verdictType: "warning",
    story: `We could not parse this execution plan.\n\nPossible reasons:\n• Unsupported format\n• Malformed plan\n\nError: ${errorMsg}`,
    bottleneck: null,
    issues: [],
    steps: []
  };
}
