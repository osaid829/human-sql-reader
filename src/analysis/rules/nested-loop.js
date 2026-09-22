// src/analysis/rules/nested-loop.js
// Browser-compatible ES module

export function analyzeNestedLoop(node, formatLargeNumber) {
  const findings = [];
  
  if (node.operation.includes("Nested Loop") && node.children.length === 2) {
    const outerNode = node.children[0];
    const innerNode = node.children[1];
    
    // We want to detect if the inner node is executed many times
    const loops = innerNode.loops || outerNode.actualRows || outerNode.estimatedRows || 0;
    
    if (loops > 10000) {
      findings.push({
        id: `nested-loop-amplification-${node.id}`,
        severity: "medium",
        confidence: innerNode.loops != null ? "high" : "medium",
        category: "join",
        title: `Nested Loop Amplification`,
        summary: `The inner part of this join was executed ${formatLargeNumber(loops)} times.`,
        evidence: [
          { label: "Outer Rows (Loops)", value: formatLargeNumber(loops) }
        ],
        recommendation: `Repeated inner work can be slow if the inner scan is not highly optimized (like a Unique Index Lookup). Check if a Hash Join or Merge Join would be better, which might require updating statistics or increasing work_mem.`,
        nodeIds: [node.id]
      });
    }
  }
  
  return findings;
}
