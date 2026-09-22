// src/analysis/rules/sorting.js
// Browser-compatible ES module

export function analyzeSorting(node, formatLargeNumber) {
  const findings = [];
  
  if (node.operation.includes("Sort")) {
    if (node.sortSpaceType && node.sortSpaceType.toLowerCase() === "disk") {
      findings.push({
        id: `sort-spill-${node.id}`,
        severity: "high",
        confidence: "high",
        category: "sort",
        title: `Disk Sort Detected`,
        summary: `The sort operation exceeded available working memory and spilled to disk.`,
        evidence: [
          { label: "Space Used", value: `${node.sortSpaceUsedKb} kB` },
          { label: "Space Type", value: "Disk" },
          { label: "Sort Method", value: node.sortMethod }
        ],
        recommendation: `Disk sorts are significantly slower than in-memory sorts. Consider increasing work_mem or adding an index that matches the ORDER BY clause to avoid sorting entirely.`,
        nodeIds: [node.id]
      });
    } else {
        // Just a normal sort without explicitly knowing it spilled, but could be expensive
        const rows = node.actualRows || node.estimatedRows || 0;
        if (rows > 100000) {
             findings.push({
                id: `large-sort-${node.id}`,
                severity: "medium",
                confidence: node.actualRows != null ? "high" : "medium",
                category: "sort",
                title: `Large Sort Operation`,
                summary: `Sorting ${formatLargeNumber(rows)} rows requires significant CPU and memory.`,
                evidence: [
                  { label: "Rows Sorted", value: formatLargeNumber(rows) }
                ],
                recommendation: `If this is slow, consider adding an index that matches the ORDER BY or GROUP BY clause to provide data already sorted.`,
                nodeIds: [node.id]
              });
        }
    }
  } else if (node.metadata?.using_filesort) {
      findings.push({
          id: `mysql-filesort-${node.id}`,
          severity: "medium",
          confidence: "medium",
          category: "sort",
          title: `Filesort on '${node.relation ?? "table"}'`,
          summary: `MySQL is sorting rows without an index.`,
          evidence: [],
          recommendation: `Add an index matching the ORDER BY columns to avoid this sorting step.`,
          nodeIds: [node.id]
        });
  }
  
  return findings;
}
