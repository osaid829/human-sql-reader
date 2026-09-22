// src/analysis/rules/parallel.js
// Browser-compatible ES module

export function analyzeParallel(node, formatLargeNumber) {
  const findings = [];
  
  if (node.workersPlanned != null && node.workersLaunched != null) {
    if (node.workersPlanned > node.workersLaunched) {
      findings.push({
        id: `parallel-workers-${node.id}`,
        severity: "low",
        confidence: "high",
        category: "parallel",
        title: `Parallel Workers Limited`,
        summary: `The database planned to use ${node.workersPlanned} parallel workers but only launched ${node.workersLaunched}.`,
        evidence: [
          { label: "Workers Planned", value: node.workersPlanned.toString() },
          { label: "Workers Launched", value: node.workersLaunched.toString() }
        ],
        recommendation: `This usually happens if max_parallel_workers or max_worker_processes limits are reached. If this query needs more parallelism, check your server configuration.`,
        nodeIds: [node.id]
      });
    }
  }
  
  return findings;
}
