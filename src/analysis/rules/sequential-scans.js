// src/analysis/rules/sequential-scans.js
// Browser-compatible ES module

export function analyzeSequentialScans(node, formatLargeNumber) {
  const findings = [];
  
  if (node.engine === "postgresql" && node.operation.includes("Seq Scan")) {
    const totalExamined = (node.actualRows || node.estimatedRows || 0) + (node.rowsRemovedByFilter || 0);
    const returned = node.actualRows || node.estimatedRows || 0;
    
    // Only flag if it's scanning a lot of rows and throwing most away, or just scanning a huge table.
    if (totalExamined > 10000) {
      if (node.rowsRemovedByFilter > 0 && (node.rowsRemovedByFilter / totalExamined) > 0.5) {
        findings.push({
          id: `seq-scan-filter-${node.id}`,
          severity: "high",
          confidence: node.actualRows != null ? "high" : "medium",
          category: "scan",
          title: `Inefficient Sequential Scan on ${node.relation || "table"}`,
          summary: `A sequential scan examined ${formatLargeNumber(totalExamined)} rows but discarded ${formatLargeNumber(node.rowsRemovedByFilter)} of them.`,
          evidence: [
            { label: "Rows Examined", value: formatLargeNumber(totalExamined) },
            { label: "Rows Returned", value: formatLargeNumber(returned) },
            { label: "Rows Removed by Filter", value: formatLargeNumber(node.rowsRemovedByFilter) }
          ],
          recommendation: `Check whether the filtered column has an appropriate index and whether its cardinality makes an index useful.`,
          nodeIds: [node.id]
        });
      } else if (returned > 100000) {
        findings.push({
          id: `seq-scan-large-${node.id}`,
          severity: "medium",
          confidence: node.actualRows != null ? "high" : "medium",
          category: "scan",
          title: `Large Sequential Scan on ${node.relation || "table"}`,
          summary: `A sequential scan read ${formatLargeNumber(returned)} rows.`,
          evidence: [
            { label: "Rows Returned", value: formatLargeNumber(returned) }
          ],
          recommendation: `If this query is expected to return this many rows, a sequential scan might be the fastest method. If not, check your filters.`,
          nodeIds: [node.id]
        });
      }
    }
  } else if (node.engine === "mysql" && node.operation === "Full Table Scan") {
    const rows = node.estimatedRows || 0;
    if (rows > 10000) {
        findings.push({
          id: `mysql-full-scan-${node.id}`,
          severity: "warning",
          confidence: "medium",
          category: "scan",
          title: `Full Table Scan on ${node.relation || "table"}`,
          summary: `MySQL is reading all ~${formatLargeNumber(rows)} rows from '${node.relation || "table"}'.`,
          evidence: [
            { label: "Estimated Rows", value: formatLargeNumber(rows) }
          ],
          recommendation: `Add an index on the columns used in the WHERE / JOIN clause for '${node.relation || "table"}'.`,
          nodeIds: [node.id]
        });
    }
  }
  return findings;
}
