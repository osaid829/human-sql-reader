// src/analysis/rules/sequential-scans.js
// Browser-compatible ES module

export function analyzeSequentialScans(node, formatLargeNumber) {
  const findings = [];

  if (node.engine === "postgresql" && node.operation.includes("Seq Scan")) {
    const hasActualRows = node.actualRows != null;
    const hasEstimatedRows = node.estimatedRows != null;

    const actualRows = hasActualRows ? node.actualRows : null;
    const estimatedRows = hasEstimatedRows ? node.estimatedRows : null;
    const rowsRemoved = node.rowsRemovedByFilter || 0;

    /*
     * IMPORTANT:
     * Never combine estimatedRows with Rows Removed by Filter to produce
     * "rows examined".
     *
     * PostgreSQL Plan Rows are planner estimates.
     * Rows Removed by Filter is an execution-time metric.
     *
     * They are only directly comparable when actualRows is available.
     */

    if (hasActualRows) {
      const totalExamined = actualRows + rowsRemoved;

      if (
        totalExamined > 10000 &&
        rowsRemoved > 0 &&
        rowsRemoved / totalExamined > 0.5
      ) {
        const discardRatio = rowsRemoved / totalExamined;

        findings.push({
          id: `seq-scan-filter-${node.id}`,
          severity: "high",
          confidence: "high",
          category: "scan",
          title: `Highly Selective Sequential Scan on ${node.relation || "table"}`,
          summary:
            `The sequential scan examined approximately ` +
            `${formatLargeNumber(totalExamined)} rows and discarded ` +
            `${formatLargeNumber(rowsRemoved)} of them ` +
            `(${(discardRatio * 100).toFixed(1)}%).`,
          evidence: [
            {
              label: "Rows Examined",
              value: formatLargeNumber(totalExamined),
            },
            {
              label: "Actual Rows Returned",
              value: formatLargeNumber(actualRows),
            },
            {
              label: "Rows Removed by Filter",
              value: formatLargeNumber(rowsRemoved),
            },
            {
              label: "Discard Ratio",
              value: `${(discardRatio * 100).toFixed(1)}%`,
            },
          ],
          recommendation:
            "A large portion of examined rows is being discarded. " +
            "Check whether the filtering predicate has an appropriate index " +
            "and whether its selectivity makes index access worthwhile.",
          nodeIds: [node.id],
        });

        return findings;
      }

      if (actualRows > 100000) {
        findings.push({
          id: `seq-scan-large-${node.id}`,
          severity: "medium",
          confidence: "high",
          category: "scan",
          title: `Large Sequential Scan on ${node.relation || "table"}`,
          summary:
            `The sequential scan returned ` +
            `${formatLargeNumber(actualRows)} rows during execution.`,
          evidence: [
            {
              label: "Actual Rows Returned",
              value: formatLargeNumber(actualRows),
            },
          ],
          recommendation:
            "If the query genuinely needs this many rows, a sequential scan " +
            "may be appropriate. Otherwise, inspect the query predicates and " +
            "whether the result set can be reduced.",
          nodeIds: [node.id],
        });
      }

      return findings;
    }

    /*
     * No actual rows are available.
     *
     * This is an estimated EXPLAIN plan. We may discuss planner estimates,
     * but must NOT describe them as rows actually returned or examined.
     */
    if (rowsRemoved > 0) {
      const evidence = [
        {
          label: "Rows Removed by Filter",
          value: formatLargeNumber(rowsRemoved),
        },
      ];

      if (hasEstimatedRows) {
        evidence.unshift({
          label: "Estimated Rows",
          value: formatLargeNumber(estimatedRows),
        });
      }

      findings.push({
        id: `seq-scan-filter-${node.id}`,
        severity: rowsRemoved > 10000 ? "high" : "medium",
        confidence: "medium",
        category: "scan",
        title: `Sequential Scan Filtering Many Rows on ${node.relation || "table"}`,
        summary:
          `The plan reports ${formatLargeNumber(rowsRemoved)} rows removed ` +
          `by the filter. Actual rows returned are not available, so an exact ` +
          `discard ratio cannot be calculated.`,
        evidence,
        recommendation:
          "The filter is discarding a substantial number of rows. " +
          "Check whether the filtering predicate has an appropriate index " +
          "and whether the column is selective enough for that index to help. " +
          "Use EXPLAIN ANALYZE for actual returned-row counts.",
        nodeIds: [node.id],
      });

      return findings;
    }

    if (hasEstimatedRows && estimatedRows > 100000) {
      findings.push({
        id: `seq-scan-large-${node.id}`,
        severity: "medium",
        confidence: "medium",
        category: "scan",
        title: `Large Estimated Sequential Scan on ${node.relation || "table"}`,
        summary:
          `PostgreSQL estimates this sequential scan will produce ` +
          `${formatLargeNumber(estimatedRows)} rows.`,
        evidence: [
          {
            label: "Estimated Rows",
            value: formatLargeNumber(estimatedRows),
          },
        ],
        recommendation:
          "A large estimated result does not automatically make a sequential " +
          "scan inefficient. If the query is not expected to return this many " +
          "rows, inspect its filters and compare the estimate with EXPLAIN ANALYZE.",
        nodeIds: [node.id],
      });
    }
  } else if (
    node.engine === "mysql" &&
    node.operation === "Full Table Scan"
  ) {
    const rows = node.estimatedRows || 0;

    if (rows > 10000) {
      findings.push({
        id: `mysql-full-scan-${node.id}`,
        severity: "warning",
        confidence: "medium",
        category: "scan",
        title: `Full Table Scan on ${node.relation || "table"}`,
        summary:
          `MySQL estimates it will examine approximately ` +
          `${formatLargeNumber(rows)} rows from ` +
          `'${node.relation || "table"}'.`,
        evidence: [
          {
            label: "Estimated Rows",
            value: formatLargeNumber(rows),
          },
        ],
        recommendation:
          `Check whether columns used in WHERE or JOIN conditions on ` +
          `'${node.relation || "table"}' have suitable indexes and enough ` +
          `selectivity for index access to be useful.`,
        nodeIds: [node.id],
      });
    }
  }

  return findings;
}
