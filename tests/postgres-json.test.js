// tests/postgres-json.test.js — PostgreSQL JSON EXPLAIN parsing
import { parsePostgresJson } from '../src/parsers/postgres-json.js';
import { humanizeExplain } from '../humanizer.js';

const analyzePlan = `[
  {
    "Plan": {
      "Node Type": "Hash Join",
      "Join Type": "Inner",
      "Hash Cond": "(o.user_id = u.id)",
      "Total Cost": 1120.30,
      "Plan Rows": 2000,
      "Plans": [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "orders",
          "Alias": "o",
          "Total Cost": 850.00,
          "Plan Rows": 25000,
          "Filter": "(o.status = 'pending'::text)",
          "Rows Removed by Filter": 870000
        },
        {
          "Node Type": "Index Scan",
          "Relation Name": "users",
          "Alias": "u",
          "Index Name": "users_pkey",
          "Total Cost": 30.00,
          "Actual Rows": 1000,
          "Actual Loops": 1,
          "Actual Startup Time": 0.010,
          "Actual Total Time": 15.000
        }
      ]
    },
    "Planning Time": 0.182,
    "Execution Time": 48.350
  }
]`;

export default async function run() {
  const { tree, planningTimeMs, executionTimeMs } = parsePostgresJson(JSON.parse(analyzePlan));

  if (planningTimeMs !== 0.182) throw new Error('Planning Time not parsed: ' + planningTimeMs);
  if (executionTimeMs !== 48.350) throw new Error('Execution Time not parsed: ' + executionTimeMs);

  if (tree.operation !== 'Hash Join') throw new Error('Root should be Hash Join');
  if (tree.joinCondition !== '(o.user_id = u.id)') throw new Error('Join condition not parsed');
  if (tree.children.length !== 2) throw new Error('Hash Join should have 2 children');

  const seq = tree.children[0];
  if (seq.operation !== 'Seq Scan' || seq.relation !== 'orders' || seq.alias !== 'o') {
    throw new Error('Seq Scan child not parsed correctly');
  }
  if (seq.rowsRemovedByFilter !== 870000) throw new Error('Rows Removed by Filter not parsed');

  const idx = tree.children[1];
  if (idx.operation !== 'Index Scan' || idx.index !== 'users_pkey') {
    throw new Error('Index Scan child not parsed correctly');
  }
  if (idx.actualRows !== 1000 || idx.inclusiveTimeMs !== 15.000 || idx.loops !== 1) {
    throw new Error('Actual metrics not parsed correctly');
  }

  // End-to-end through humanizer
  const result = humanizeExplain(analyzePlan, 'postgres');
  if (result.engine !== 'postgresql') throw new Error('Engine should be postgresql');
  if (result.hasActual !== true) throw new Error('hasActual should be true');
  if (result.story.includes('MySQL')) throw new Error('PostgreSQL story must not mention MySQL');
  if (!result.story.includes('PostgreSQL')) throw new Error('Story should name PostgreSQL');

  // Bottleneck = node with actuals (only the Index Scan has timing here)
  if (result.bottleneck && result.bottleneck.type !== 'Index Scan') {
    throw new Error('Bottleneck should be the Index Scan, got ' + result.bottleneck.type);
  }

  // Findings engine fires for the high discard rate on the Seq Scan
  const rowsRemoved = result.issues.find(f => f.id.startsWith('rows-removed-'));
  if (!rowsRemoved) throw new Error('Expected rows-removed finding');
  if (rowsRemoved.severity !== 'high') throw new Error('rows-removed should be high severity');
  if (rowsRemoved.evidence.length === 0) throw new Error('rows-removed finding should carry evidence');
}