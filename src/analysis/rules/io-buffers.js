// src/analysis/rules/io-buffers.js
// Browser-compatible ES module

export function analyzeIoBuffers(node, formatLargeNumber) {
  const findings = [];
  
  if (node.tempReadBlocks > 0 || node.tempWrittenBlocks > 0) {
    findings.push({
      id: `temp-io-${node.id}`,
      severity: "high",
      confidence: "high",
      category: "io",
      title: `Temporary Storage I/O`,
      summary: `This execution used temporary storage on disk.`,
      evidence: [
        { label: "Temp Read Blocks", value: formatLargeNumber(node.tempReadBlocks || 0) },
        { label: "Temp Written Blocks", value: formatLargeNumber(node.tempWrittenBlocks || 0) }
      ],
      recommendation: `Memory configuration (like work_mem) and the size of the intermediate result are worth investigating. Disk I/O for temporary data can severely impact performance.`,
      nodeIds: [node.id]
    });
  }
  
  // Highlight cache hit ratio if we have reads and hits
  if (node.sharedReadBlocks != null && node.sharedHitBlocks != null) {
      const totalBlocks = node.sharedReadBlocks + node.sharedHitBlocks;
      if (totalBlocks > 1000) {
          const hitRatio = node.sharedHitBlocks / totalBlocks;
          if (hitRatio < 0.5) {
               findings.push({
                  id: `low-cache-hit-${node.id}`,
                  severity: "medium",
                  confidence: "high",
                  category: "io",
                  title: `Low Buffer Cache Hit Ratio`,
                  summary: `Only ${(hitRatio * 100).toFixed(1)}% of data blocks were found in memory; the rest required disk reads.`,
                  evidence: [
                    { label: "Shared Hits", value: formatLargeNumber(node.sharedHitBlocks) },
                    { label: "Shared Reads", value: formatLargeNumber(node.sharedReadBlocks) }
                  ],
                  recommendation: `If disk reads are slow, consider if the database has enough memory (shared_buffers) or if the query can read less data.`,
                  nodeIds: [node.id]
                });
          }
      }
  }

  return findings;
}
