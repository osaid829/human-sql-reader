// src/explanations/humanize.js
// Browser-compatible ES module

import { getPgNodeDef, getMysqlTypeDef } from "./node-definitions.js";

export function getExplanation(node, level = "simple") {
  let def;
  if (node.engine === "postgresql") {
    def = getPgNodeDef(node.operation);
  } else {
    def = getMysqlTypeDef(node.metadata?.accessType || node.operation);
  }

  return {
    label: def.label,
    category: def.category,
    summary: def[level] || def.simple,
    tip: def.tip
  };
}

export function buildStory(result) {
    const { hasActualMetrics, engine, flatNodes, bottleneck } = result;
    const stepCount = flatNodes.length;
    
    let story = `This ${engine === 'postgresql' ? 'PostgreSQL' : 'MySQL'} query plan contains **${stepCount} step${stepCount !== 1 ? 's' : ''}**. `;
    
    if (bottleneck) {
        let opName = bottleneck.operation;
        if (engine === 'postgresql') opName = getPgNodeDef(bottleneck.operation).label;
        else opName = getMysqlTypeDef(bottleneck.metadata?.accessType || bottleneck.operation).label;

        story += `The main bottleneck is **${opName}**`;
        if (bottleneck.relation) {
            story += ` on \`${bottleneck.relation}\``;
        }
        
        if (bottleneck.exclusiveTimeMsApprox != null && bottleneck.exclusiveTimeMsApprox > 0) {
             story += `, taking approximately **${bottleneck.exclusiveTimeMsApprox.toFixed(2)} ms** of exclusive time.`;
        } else if (bottleneck.inclusiveTimeMs != null && bottleneck.inclusiveTimeMs > 0) {
             story += `, taking **${bottleneck.inclusiveTimeMs.toFixed(2)} ms** inclusive.`;
        } else if (bottleneck.estimatedCostTotal != null) {
            story += `, with the highest estimated cost of **${bottleneck.estimatedCostTotal.toLocaleString()}**.`;
        } else if (bottleneck.estimatedRows != null) {
            story += `, scanning ~**${bottleneck.estimatedRows.toLocaleString()}** rows.`;
        } else {
            story += `.`;
        }
    }

    return story;
}
