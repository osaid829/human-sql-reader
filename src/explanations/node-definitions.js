// src/explanations/node-definitions.js — Knowledge base for plan operations
// Browser-compatible ES module
//
// Preserved and extended from the original humanizer.js PG_NODE_DEFS and MYSQL_TYPE_DEFS

/**
 * PostgreSQL node type definitions.
 * Keys are PostgreSQL Node Type strings.
 */
export const PG_NODE_DEFS = {
  "Seq Scan": {
    label: "Sequential Scan (Full Table Scan)",
    category: "scan",
    simple: "The database read through the table row by row.",
    developer: "PostgreSQL performed a sequential scan, reading every row from the table's heap pages and applying any filter conditions afterward.",
    advanced: "Sequential scan reads heap pages in physical order. The planner chooses this when no suitable index exists, when the table is small enough that an index provides no benefit, or when the query's selectivity is too low for an index scan to be efficient.",
    tip: "Not always bad — small tables and low-selectivity queries are often faster with a sequential scan than an index scan.",
  },
  "Index Scan": {
    label: "Index Scan",
    category: "scan",
    simple: "The database used an index to find specific rows, then fetched the full row data.",
    developer: "PostgreSQL traversed a B-tree (or other) index to locate matching rows, then fetched each row from the table heap. Efficient when returning a small percentage of rows.",
    advanced: "Index scan traverses the index structure, then performs random I/O to fetch matching heap tuples. For each index entry, it reads the corresponding table page. Cost is proportional to the number of matching rows and the randomness of the heap access pattern.",
    tip: "Efficient for queries returning a small percentage of rows. If returning many rows, a bitmap scan or sequential scan may be preferred.",
  },
  "Index Only Scan": {
    label: "Index-Only Scan",
    category: "scan",
    simple: "The database answered the query entirely from the index, without reading the table.",
    developer: "PostgreSQL satisfied the query using only data stored in the index, avoiding heap access. This is the fastest scan type when the index covers all required columns.",
    advanced: "Index-only scan avoids heap fetches when the visibility map confirms all tuples on a page are visible. Heap Fetches > 0 indicates some pages required visibility checks. A recent VACUUM improves index-only scan efficiency.",
    tip: "Best scan type. Keep indexes updated and VACUUM regularly to minimize heap fetches.",
  },
  "Bitmap Heap Scan": {
    label: "Bitmap Heap Scan",
    category: "scan",
    simple: "The database gathered row locations from an index, then fetched them from the table in order.",
    developer: "PostgreSQL used a bitmap of matching row locations to fetch heap tuples in physical page order, reducing random I/O compared to a regular index scan.",
    advanced: "Bitmap heap scan sorts TIDs from a bitmap index scan by physical location before fetching. This converts random I/O to sequential I/O. With lossy bitmaps (when memory is insufficient for exact TID tracking), it rechecks conditions on each page.",
    tip: "Normal for moderate-selectivity queries. More efficient than index scan for many matching rows.",
  },
  "Bitmap Index Scan": {
    label: "Bitmap Index Scan",
    category: "scan",
    simple: "The database scanned an index and built a list of matching row locations.",
    developer: "PostgreSQL traversed an index and built an in-memory bitmap of matching heap page locations. This is the preparation step before a Bitmap Heap Scan.",
    advanced: "Creates a bitmap of page numbers (or exact TIDs if memory allows) from index entries. Multiple bitmap index scans can be combined with BitmapAnd/BitmapOr operations for multi-column filtering.",
    tip: "Usually paired with Bitmap Heap Scan. The bitmap approach is chosen when too many rows match for an index scan but fewer than a sequential scan.",
  },
  "Nested Loop": {
    label: "Nested Loop Join",
    category: "join",
    simple: "For every row from one table, the database looked up matching rows in another table.",
    developer: "PostgreSQL iterated over the outer relation and, for each row, executed the inner plan to find matching rows. Efficient when the outer relation is small and the inner has a fast index lookup.",
    advanced: "Nested loop join has O(outer × inner) complexity. With an indexed inner scan, effective cost is O(outer × log(inner)). The planner chooses this when the outer relation is small or when no equi-join condition exists for hash/merge joins.",
    tip: "Watch the outer row count × loops. If the outer table has many rows, this join strategy can be very expensive.",
  },
  "Hash Join": {
    label: "Hash Join",
    category: "join",
    simple: "The database loaded one table into a hash table, then matched rows from the other table against it.",
    developer: "PostgreSQL built an in-memory hash table from the smaller relation (build side), then probed it with each row from the larger relation (probe side).",
    advanced: "Hash join builds a hash table in work_mem. If the build side exceeds work_mem, it spills to disk using batch-based processing, which is significantly slower. The number of batches indicates spill severity.",
    tip: "Efficient for equi-joins on unsorted data. If you see batches > 1, the hash table spilled to disk — consider increasing work_mem.",
  },
  "Merge Join": {
    label: "Merge Join",
    category: "join",
    simple: "The database merged two already-sorted sets of data together.",
    developer: "PostgreSQL zipped through two pre-sorted inputs, matching rows in a single pass. Very efficient for large datasets when both inputs are already sorted.",
    advanced: "Merge join requires both inputs sorted on the join key. It advances through both in lockstep. If inputs aren't pre-sorted (via index), PostgreSQL adds explicit Sort nodes. Best for large equi-joins where both sides can be cheaply sorted.",
    tip: "Most efficient join for large datasets when both inputs are sorted by the join key.",
  },
  "Sort": {
    label: "Sort",
    category: "sort",
    simple: "The database sorted rows to satisfy an ORDER BY or as preparation for another operation.",
    developer: "PostgreSQL sorted the input rows. If the sort fits in work_mem, it uses quicksort in memory. If it exceeds work_mem, it spills to disk using an external merge sort.",
    advanced: "Sort nodes appear for ORDER BY, merge joins, and group aggregates. Sort Method indicates the algorithm used. 'quicksort Memory: NkB' means in-memory. 'external merge Disk: NkB' means disk spill. The transition from memory to disk sort significantly impacts performance.",
    tip: "If sorting spills to disk ('external merge'), consider increasing work_mem or adding an index that provides pre-sorted output.",
  },
  "Incremental Sort": {
    label: "Incremental Sort",
    category: "sort",
    simple: "The database sorted partially pre-sorted data more efficiently.",
    developer: "PostgreSQL exploited existing partial sort order to sort only the remaining columns, reducing memory usage and sort time compared to a full sort.",
    advanced: "Introduced in PostgreSQL 13. When input is already sorted on a prefix of the sort keys, incremental sort groups by the presorted keys and sorts only within each group. This reduces memory usage from O(N) to O(group_size).",
    tip: "More efficient than full sort when data is partially ordered.",
  },
  "Aggregate": {
    label: "Aggregate",
    category: "aggregate",
    simple: "The database computed summary values (COUNT, SUM, AVG, etc.).",
    developer: "PostgreSQL aggregated rows to produce summary results. Plain Aggregate processes all rows into a single group.",
    advanced: "Plain aggregate computes a single group (no GROUP BY). Uses minimal memory since it only maintains running aggregate state.",
    tip: "Usually efficient. Performance depends on the number of input rows.",
  },
  "HashAggregate": {
    label: "Hash Aggregate",
    category: "aggregate",
    simple: "The database grouped rows using a hash table and computed summary values.",
    developer: "PostgreSQL used an in-memory hash table to group rows by the GROUP BY keys and compute aggregates in a single pass.",
    advanced: "Hash aggregate builds a hash table with one entry per distinct group. Memory usage is proportional to the number of distinct groups. If groups exceed work_mem, it can spill to disk (PostgreSQL 13+).",
    tip: "Efficient for moderate numbers of groups. If it spills to disk, consider whether the number of distinct groups is unexpectedly large.",
  },
  "GroupAggregate": {
    label: "Group Aggregate",
    category: "aggregate",
    simple: "The database grouped already-sorted rows and computed summary values in one pass.",
    developer: "PostgreSQL processed pre-sorted rows sequentially, computing aggregates for each group without building a hash table.",
    advanced: "Group aggregate requires input sorted by the GROUP BY keys. It processes groups sequentially with O(1) memory overhead per group. Combined with an index scan that provides the sort order, this can be very efficient.",
    tip: "Efficient when input is already sorted by the GROUP BY key (e.g., via an index).",
  },
  "Limit": {
    label: "Limit",
    category: "limit",
    simple: "The database stopped after finding the requested number of rows.",
    developer: "PostgreSQL stopped executing the child plan once the LIMIT row count was reached.",
    advanced: "Limit terminates child execution early. Combined with an index scan, this can make queries that would otherwise be expensive very fast. OFFSET with large values still requires scanning and discarding rows.",
    tip: "Efficient when the underlying scan finds matching rows quickly. Large OFFSET values can still be slow.",
  },
  "Materialize": {
    label: "Materialize",
    category: "other",
    simple: "The database stored intermediate results so they could be read multiple times.",
    developer: "PostgreSQL materialized the output of a subplan into memory (or disk) so it can be re-scanned without re-executing the subplan.",
    advanced: "Used by nested loops to avoid re-executing expensive inner plans. Stores results in a tuplestore. If the result set exceeds work_mem, it spills to disk.",
    tip: "Usually harmless overhead. Problematic only when the materialized result set is very large.",
  },
  "Memoize": {
    label: "Memoize",
    category: "other",
    simple: "The database cached results from repeated lookups to avoid redundant work.",
    developer: "PostgreSQL cached the results of parameterized inner plans in a hash table, returning cached results for previously-seen parameter values.",
    advanced: "Introduced in PostgreSQL 14. Memoize sits between a nested loop and its inner plan, caching results keyed by the join parameters. Cache hits avoid re-executing the inner plan. Effectiveness depends on the ratio of distinct parameter values to total loops.",
    tip: "Check cache hit ratio. High hit ratio means significant work saved. Low hit ratio may indicate the cache is not effective.",
  },
  "Hash": {
    label: "Hash (Build Phase)",
    category: "join",
    simple: "The database built a hash table from a set of rows for use in a Hash Join.",
    developer: "PostgreSQL built an in-memory hash table from the inner relation for the parent Hash Join to probe.",
    advanced: "Hash build phase reads the inner relation and inserts all tuples into a hash table. Memory Buckets and Batches indicate the hash table structure. Batches > 1 means the hash table exceeded work_mem and spilled to disk.",
    tip: "If batches > 1, the hash table spilled to disk. Consider increasing work_mem.",
  },
  "Gather": {
    label: "Gather (Parallel)",
    category: "parallel",
    simple: "The database collected results from parallel worker processes.",
    developer: "PostgreSQL gathered results from parallel worker processes into a single stream. Workers execute the child plan in parallel.",
    advanced: "Gather collects tuples from workers in arrival order (not sorted). The leader process may also execute the child plan. Workers Planned vs Workers Launched shows if all requested workers were available.",
    tip: "Workers Launched < Workers Planned may indicate max_parallel_workers limit. Each worker uses its own work_mem.",
  },
  "Gather Merge": {
    label: "Gather Merge (Parallel, Sorted)",
    category: "parallel",
    simple: "The database collected pre-sorted results from parallel workers and merged them.",
    developer: "PostgreSQL gathered pre-sorted results from parallel workers and merge-sorted them into a single ordered stream.",
    advanced: "Like Gather, but preserves sort order from workers using a merge algorithm. More expensive than plain Gather due to the merge step, but necessary when the query requires ordered output from parallel workers.",
    tip: "More expensive than Gather but preserves sort order.",
  },
  "CTE Scan": {
    label: "CTE Scan",
    category: "scan",
    simple: "The database scanned the results of a WITH (Common Table Expression) query.",
    developer: "PostgreSQL scanned a previously materialized CTE result. In PostgreSQL < 12, CTEs are always materialized (optimization fence). In 12+, they may be inlined unless explicitly materialized.",
    advanced: "CTE scan reads from a tuplestore created by executing the CTE's subplan. If the CTE is materialized and referenced multiple times, the subplan executes once. In PG 12+, use NOT MATERIALIZED to allow inlining.",
    tip: "On PostgreSQL 12+, consider NOT MATERIALIZED if the CTE is used once and benefits from predicate pushdown.",
  },
  "Subquery Scan": {
    label: "Subquery Scan",
    category: "scan",
    simple: "The database scanned the output of a subquery.",
    developer: "PostgreSQL wrapped a sub-SELECT output as a virtual table that can be scanned.",
    advanced: "Subquery scan is usually a thin wrapper around a subplan. It provides a consistent scan interface for the parent plan. The overhead is minimal — check the child plan for actual performance characteristics.",
    tip: "Usually harmless wrapper. Focus on the efficiency of the child subquery.",
  },
  "Append": {
    label: "Append",
    category: "other",
    simple: "The database combined results from multiple sources.",
    developer: "PostgreSQL combined output from multiple child plans, used for UNION ALL, partitioned table scans, or table inheritance.",
    advanced: "Append executes each child plan sequentially and concatenates results. For partitioned tables, partition pruning eliminates children for irrelevant partitions.",
    tip: "Each child plan executes independently. Check if partition pruning is effective for partitioned tables.",
  },
  "Result": {
    label: "Result",
    category: "other",
    simple: "The database computed a result without scanning any table.",
    developer: "PostgreSQL produced a result from constant expressions or function calls without needing to scan a table.",
    advanced: "Result nodes appear for queries that can be resolved at planning time (e.g., SELECT 1), for INSERT with VALUES, and as a gating node for constant false conditions.",
    tip: "Usually zero cost and no performance concern.",
  },
  "WindowAgg": {
    label: "Window Aggregate",
    category: "aggregate",
    simple: "The database computed window function results (ROW_NUMBER, RANK, LAG, etc.).",
    developer: "PostgreSQL evaluated window functions over a sorted partition of rows.",
    advanced: "Window aggregate processes sorted input, maintaining a window frame for each partition. Requires input sorted by the PARTITION BY and ORDER BY keys of the window specification.",
    tip: "Ensure input is sorted efficiently (via index) to avoid an additional sort step.",
  },
  "Unique": {
    label: "Unique",
    category: "other",
    simple: "The database removed duplicate rows from sorted input.",
    developer: "PostgreSQL removed consecutive duplicate rows from pre-sorted input, implementing DISTINCT or UNION.",
    advanced: "Unique requires sorted input on the deduplication keys. It compares adjacent rows and emits only when the key changes. O(N) with constant memory.",
    tip: "Efficient when input is already sorted. If not, look at the child sort node's cost.",
  },
};

/**
 * MySQL access type definitions.
 */
export const MYSQL_TYPE_DEFS = {
  ALL: {
    label: "Full Table Scan",
    category: "scan",
    simple: "MySQL read every row in the table.",
    developer: "MySQL performed a full table scan — no index was used. All rows were read from disk or buffer pool.",
    advanced: "Full table scan reads all rows in the clustered index (InnoDB) or data file (MyISAM). Chosen when no usable index exists, or when the optimizer estimates that using an index would be slower than reading the entire table.",
    tip: "For large tables, adding an index on the filtered columns can dramatically reduce the number of rows examined.",
  },
  index: {
    label: "Full Index Scan",
    category: "scan",
    simple: "MySQL scanned every entry in an index.",
    developer: "MySQL scanned the entire index tree, reading all entries in index order. Better than a full table scan if the index is smaller than the table.",
    advanced: "Full index scan reads all index leaf pages. Used when the query can be satisfied from the index alone (covering index) or when the index order matches the required sort order.",
    tip: "If the query can use a more selective condition, a range or ref scan would be faster.",
  },
  range: {
    label: "Index Range Scan",
    category: "scan",
    simple: "MySQL used an index to read a range of rows efficiently.",
    developer: "MySQL used an index to scan a contiguous range of rows matching BETWEEN, <, >, or IN() conditions.",
    advanced: "Range scan reads a subset of index entries between boundary values. Cost depends on the range width and whether the data pages are in the buffer pool.",
    tip: "Good access pattern. Ensure the range isn't too wide.",
  },
  ref: {
    label: "Non-Unique Index Lookup",
    category: "scan",
    simple: "MySQL looked up rows using a non-unique index.",
    developer: "MySQL used a non-unique index (or the leftmost prefix of a composite index) to find matching rows.",
    advanced: "Ref access uses an index to find rows matching a constant value. Multiple rows may match. Cost is proportional to the number of matching rows. The ref column shows which column or constant is used for the lookup.",
    tip: "Efficient for JOIN and WHERE equality conditions. Ensure the index covers all join/filter columns.",
  },
  eq_ref: {
    label: "Unique Index Lookup",
    category: "scan",
    simple: "MySQL matched exactly one row using a unique index.",
    developer: "MySQL used a PRIMARY KEY or UNIQUE index to look up exactly one row per key value. This is the most efficient join type.",
    advanced: "Eq_ref reads at most one row per key value from a table with a UNIQUE NOT NULL index. Used for joins on primary key or unique columns.",
    tip: "Optimal — the most efficient join access type.",
  },
  const: {
    label: "Constant Lookup",
    category: "scan",
    simple: "MySQL resolved this table to a single row at query optimization time.",
    developer: "MySQL determined at optimization time that at most one row matches, using a PRIMARY KEY or UNIQUE index with constant values.",
    advanced: "The table is read at most once and the row values become constants for the rest of the query. The most efficient access type.",
    tip: "Optimal — as fast as it gets.",
  },
  system: {
    label: "System Table (Single Row)",
    category: "scan",
    simple: "The table has exactly one row.",
    developer: "The table has exactly one row — a special case of const access.",
    advanced: "System tables with a single row are read once and become constant. Extremely rare in practice.",
    tip: "No performance concern.",
  },
  ref_or_null: {
    label: "Index Lookup (with NULL check)",
    category: "scan",
    simple: "MySQL looked up rows using an index, plus checked for NULL values.",
    developer: "Like ref, but MySQL also searches for NULL values. Handles `col = value OR col IS NULL` patterns.",
    advanced: "Ref_or_null performs a regular ref lookup plus an additional search for NULL entries in the index. Slightly more expensive than ref.",
    tip: "Usually fine. Verify that the NULL check is intentional.",
  },
  fulltext: {
    label: "Fulltext Index Search",
    category: "scan",
    simple: "MySQL used a fulltext index for text searching.",
    developer: "MySQL used a FULLTEXT index to match MATCH(...) AGAINST(...) queries.",
    advanced: "Fulltext search uses MySQL's built-in full-text search engine. Performance depends on the index size and the complexity of the search expression.",
    tip: "Ensure the fulltext index covers all searched columns.",
  },
  index_merge: {
    label: "Index Merge",
    category: "scan",
    simple: "MySQL combined results from multiple indexes on the same table.",
    developer: "MySQL used multiple indexes on the same table and combined (intersect or union) the results. Used when OR conditions each have their own index.",
    advanced: "Index merge can use intersection (AND), union (OR), or sort-union strategies. A composite index covering both conditions is usually more efficient than an index merge.",
    tip: "Consider a composite index covering both conditions instead of relying on index merge.",
  },

  // TREE / EXPLAIN ANALYZE operation names (used when a node has no access_type)
  "Nested Loop": {
    label: "Nested Loop Join",
    category: "join",
    simple: "MySQL matched each outer row against the inner table, one pair at a time.",
    developer: "MySQL nested-loop-joined two tables, executing the inner access path once per outer row.",
    advanced: "In MySQL TREE output, 'Nested loop inner join' iterates the outer rows and probes the inner table for each. The number of loops on the inner node shows how many times the inner path ran.",
    tip: "Look at the inner node's loops. Large loop counts mean the inner lookup ran many times.",
  },
  "Filesort": {
    label: "Filesort (Sort Without Index)",
    category: "sort",
    simple: "MySQL sorted rows in memory or to temporary files.",
    developer: "MySQL performed a filesort to satisfy the ordering requirement.",
    advanced: "A filesort happens when no index matches the ORDER BY / GROUP BY. Small sorts happen in memory; larger ones spill to temporary files on disk.",
    tip: "Add an index that matches the ORDER BY or GROUP BY columns to avoid filesort.",
  },
  "Filter": {
    label: "Filter (Condition Check)",
    category: "filter",
    simple: "MySQL checked each row against a filter condition.",
    developer: "MySQL applied a filter condition (WHERE or JOIN predicate) to the rows produced by the child node.",
    advanced: "A separate filter step means the condition could not be pushed into the access path. Filtering later tends to examine more rows than filtering at the index.",
    tip: "Compare the actual rows vs the rows that passed the filter to spot wasteful filtering.",
  },
  "Group": {
    label: "Grouping Operation",
    category: "aggregate",
    simple: "MySQL grouped rows and computed summary values.",
    developer: "MySQL applied GROUP BY aggregation.",
    advanced: "Grouping with a temporary table or filesort can be expensive; an index on the group columns avoids the extra sort.",
    tip: "An index on the GROUP BY columns can remove the temporary table / filesort step.",
  },
  "Aggregate": {
    label: "Aggregate",
    category: "aggregate",
    simple: "MySQL computed aggregate values (COUNT, SUM, AVG, etc.).",
    developer: "MySQL computed summary values over the child's rows.",
    advanced: "Aggregates are cheap when the child produces few rows; check the child for the real bottleneck.",
    tip: "Usually efficient - look at the child node for the actual cost.",
  },
  "Hash Join": {
    label: "Hash Join",
    category: "join",
    simple: "MySQL built a hash table from one input and probed it with the other.",
    developer: "MySQL used an in-memory hash table to match the two join inputs.",
    advanced: "Hash joins (used with hash-join-able conditions) avoid the O(n×m) behavior of nested loops on large inputs.",
    tip: "Good choice for large equi-joins.",
  },
  "Union": {
    label: "Union",
    category: "other",
    simple: "MySQL combined the results of multiple queries.",
    developer: "MySQL appended the outputs of multiple branches for UNION / UNION ALL.",
    advanced: "UNION ALL simply concatenates; plain UNION also removes duplicates, which may add a temporary table step.",
    tip: "Use UNION ALL when you don't need deduplication - it avoids the extra step.",
  },
  "Materialize": {
    label: "Materialize",
    category: "other",
    simple: "MySQL stored intermediate results so they could be reused.",
    developer: "MySQL materialized a subquery or derived table into a temporary structure for reuse.",
    advanced: "Materialized results may be spilled to a temporary table. Check whether the materialized set is much larger than expected.",
    tip: "Usually fine; a surprisingly large materialization suggests a missing filter or index.",
  },
  "Duplicates Removal": {
    label: "Duplicates Removal",
    category: "other",
    simple: "MySQL removed duplicate rows from the result.",
    developer: "MySQL removed duplicates for DISTINCT-style operations.",
    advanced: "Duplicates removal typically uses a hash or temporary table, costing extra memory.",
    tip: "Only request DISTINCT when duplicates are actually possible.",
  },
  "Temporary Table": {
    label: "Temporary Table Usage",
    category: "other",
    simple: "MySQL created a temporary table for an intermediate result.",
    developer: "MySQL stored an intermediate result in a temporary table.",
    advanced: "Temporary tables on disk are slow. In-memory temporary tables (MEMORY engine) are fast but size-limited.",
    tip: "Reduce the intermediate result size or add indexes used by the temporary table.",
  },
  "Subquery": {
    label: "Subquery",
    category: "other",
    simple: "MySQL executed a subquery as part of the plan.",
    developer: "MySQL executed a subquery, often materializing it first.",
    advanced: "Correlated subqueries re-run per outer row; check the child loop counts.",
    tip: "Rewriting a correlated subquery as a JOIN often performs better.",
  },
};

/**
 * Get the definition for a PostgreSQL node type.
 * @param {string} operation — the node type (e.g., "Seq Scan", "Hash Join")
 * @returns {Object}
 */
export function getPgNodeDef(operation) {
  // Direct match
  if (PG_NODE_DEFS[operation]) {
    return PG_NODE_DEFS[operation];
  }

  // Partial match (e.g., "Nested Loop Left Join" contains "Nested Loop")
  const lower = operation.toLowerCase();
  for (const [key, val] of Object.entries(PG_NODE_DEFS)) {
    if (lower.includes(key.toLowerCase())) {
      return val;
    }
  }

  // Unknown node type
  return {
    label: operation,
    category: "other",
    simple: `Executed operation: ${operation}.`,
    developer: `PostgreSQL performed operation: ${operation}.`,
    advanced: `Operation: ${operation}. Check PostgreSQL documentation for details on this node type.`,
    tip: "Look at the cost, row counts, and timing to determine if this step is expensive.",
  };
}

/**
 * Get the definition for a MySQL access type.
 * @param {string} accessType — e.g., "ALL", "ref", "eq_ref"
 * @returns {Object}
 */
export function getMysqlTypeDef(accessType) {
  if (MYSQL_TYPE_DEFS[accessType]) {
    return MYSQL_TYPE_DEFS[accessType];
  }

  return {
    label: `Access Type: ${accessType}`,
    category: "other",
    simple: `MySQL access type: ${accessType}.`,
    developer: `MySQL used access type '${accessType}'.`,
    advanced: `Access type: ${accessType}. Check MySQL documentation for details.`,
    tip: "Check the MySQL docs for this access type.",
  };
}
