// tests/postgres-text.test.js
import { detectFormat } from '../src/core/detect-format.js';
import { parsePostgresText } from '../src/parsers/postgres-text.js';
import { humanizeExplain } from '../humanizer.js';

export default async function run() {
  const plan = `Sort  (cost=1230.45..1235.45 rows=2000 width=64)
  Sort Key: u.created_at DESC
  ->  Hash Join  (cost=45.20..1120.30 rows=2000 width=64)
        Hash Cond: (o.user_id = u.id)
        ->  Seq Scan on orders o  (cost=0.00..850.00 rows=25000 width=32)
        ->  Hash  (cost=30.00..30.00 rows=1000 width=32)
              ->  Index Scan using users_pkey on users u  (cost=0.28..30.00 rows=1000 width=32)`;

  const detection = detectFormat(plan);
  if (detection.engine !== 'postgresql' || detection.format !== 'text') {
    throw new Error('Failed to detect PostgreSQL text format');
  }

  const { tree } = parsePostgresText(plan);
  
  if (tree.operation !== 'Sort') throw new Error('Root operation should be Sort');
  if (tree.children.length !== 1) throw new Error('Sort should have 1 child');
  if (tree.children[0].operation !== 'Hash Join') throw new Error('Child should be Hash Join');
  if (tree.children[0].children.length !== 2) throw new Error('Hash Join should have 2 children');
  
  const seqScan = tree.children[0].children[0];
  if (seqScan.operation !== 'Seq Scan' || seqScan.relation !== 'orders' || seqScan.alias !== 'o') {
    throw new Error('Seq Scan not parsed correctly');
  }

  const indexScan = tree.children[0].children[1].children[0];
  if (indexScan.operation !== 'Index Scan' || indexScan.relation !== 'users' || indexScan.index !== 'users_pkey') {
    throw new Error('Index Scan not parsed correctly');
  }

  // ── Bitmap Index Scan: index name must be captured, not a relation ───────
  const bitmap = `Bitmap Heap Scan on users  (cost=4.38..13.60 rows=4 width=44)
  Recheck Cond: (email = 'x@y.com'::text)
  ->  Bitmap Index Scan on idx_users_email  (cost=0.00..4.38 rows=4 width=0)`;

  const { tree: bitmapTree } = parsePostgresText(bitmap);
  const bitmapIndex = bitmapTree.children[0];
  if (bitmapIndex.operation !== 'Bitmap Index Scan') throw new Error('Expected Bitmap Index Scan');
  if (bitmapIndex.index !== 'idx_users_email') {
    throw new Error('Bitmap Index Scan should capture index name, got ' + JSON.stringify(bitmapIndex.index));
  }
  if (bitmapIndex.relation != null) {
    throw new Error('Bitmap Index Scan should not set relation, got ' + bitmapIndex.relation);
  }

  // ── Parallel operators ───────────────────────────────────────────────────
  const parallel = `Gather  (cost=1000.00..1200.00 rows=50000 width=32)
  Workers Planned: 2
  ->  Parallel Seq Scan on orders  (cost=0.00..600.00 rows=25000 width=32)
  ->  Parallel Index Scan using orders_pkey on orders  (cost=0.28..30.00 rows=1000 width=32)
  ->  Parallel Index Only Scan using idx_orders_user on orders  (cost=0.28..5.00 rows=10 width=4)
  ->  Parallel Bitmap Heap Scan on users  (cost=4.38..13.60 rows=4 width=44)`;

  const { tree: parTree, workersPlanned } = (() => {
    const r = parsePostgresText(parallel);
    return r;
  })();

  const parNodes = [parTree, ...parTree.children];
  const expectPar = (operation, index, relation) => {
    const node = parNodes.find(n => n.operation === operation);
    if (!node) throw new Error('Missing parallel operation: ' + operation);
    if (node.relation !== relation) throw new Error(operation + ' relation mismatch');
    if (node.index !== index) throw new Error(operation + ' index mismatch');
  };
  expectPar('Parallel Seq Scan', undefined, 'orders');
  expectPar('Parallel Index Scan', 'orders_pkey', 'orders');
  expectPar('Parallel Index Only Scan', 'idx_orders_user', 'orders');
  expectPar('Parallel Bitmap Heap Scan', undefined, 'users');

  // ── EXPLAIN ANALYZE actuals + Planning/Execution Time extraction ─────────
  const analyze = `Sort  (cost=850.12..855.12 rows=2000 width=48) (actual time=45.230..48.120 rows=1500 loops=1)
  Sort Key: created_at DESC
  ->  Seq Scan on event_logs  (cost=0.00..720.00 rows=2000 width=48) (actual time=0.045..42.150 rows=1500 loops=1)
        Filter: (event_type = 'checkout_failed'::text)
        Rows Removed by Filter: 98500
Planning Time: 0.182 ms
Execution Time: 48.350 ms`;

  const analyzeResult = parsePostgresText(analyze);
  if (analyzeResult.planningTimeMs !== 0.182) throw new Error('Planning Time not extracted');
  if (analyzeResult.executionTimeMs !== 48.350) throw new Error('Execution Time not extracted');

  const rootSort = analyzeResult.tree;
  if (rootSort.actualRows !== 1500 || rootSort.inclusiveTimeMs !== 48.120) {
    throw new Error('Sort actuals not parsed');
  }
  const seq = rootSort.children[0];
  if (seq.rowsRemovedByFilter !== 98500) throw new Error('Rows Removed by Filter not parsed');

  // ── End-to-end humanize: story wording + findings ────────────────────────
  const result = humanizeExplain(analyze, 'postgres');
  if (result.engine !== 'postgresql') throw new Error('Engine should be postgresql');
  if (result.hasActual !== true) throw new Error('hasActual should be true');
  if (result.story.includes('MySQL')) throw new Error('Postgres story must not mention MySQL');
  if (!result.story.includes('PostgreSQL')) throw new Error('Better (unlikely) — story should name PostgreSQL');

  const finding = result.issues.find(f => f.id.startsWith('rows-removed-'));
  if (!finding || finding.severity !== 'high') {
    throw new Error('Expected high-severity rows-removed finding from ANALYZE plan');
  }
  const evidenceValues = finding.evidence.map(e => e.label.toLowerCase());
  if (!evidenceValues.some(v => v.includes('examined')) || !evidenceValues.some(v => v.includes('removed'))) {
    throw new Error('rows-removed finding should carry examined/removed evidence');
  }
}
