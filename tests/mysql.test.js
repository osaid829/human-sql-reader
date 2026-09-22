import { detectFormat } from '../src/core/detect-format.js';
import { humanizeExplain } from '../humanizer.js';

export default async function run() {
  const treePlan = `-> Table scan on users  (cost=1.23 rows=456)
    -> Index lookup on users using PRIMARY (id=1)`;
    
  const treeDetection = detectFormat(treePlan);
  if (treeDetection.engine !== 'mysql' || treeDetection.format !== 'tree') {
    throw new Error('Failed to detect MySQL TREE format: ' + JSON.stringify(treeDetection));
  }

  // MySQL TREE end-to-end
  const treeResult = humanizeExplain(treePlan, 'mysql');
  if (treeResult.engine !== 'mysql') throw new Error('MySQL TREE engine should be mysql');
  if (treeResult.stepCount === 0) throw new Error('MySQL TREE produced no steps');

  const jsonPlan = `{
    "query_block": {
      "select_id": 1,
      "cost_info": {
        "query_cost": "1240.00"
      },
      "table": {
        "table_name": "users",
        "access_type": "ALL"
      }
    }
  }`;

  const res = humanizeExplain(jsonPlan, 'mysql');
  if (res.totalCost !== 1240) {
    throw new Error('MySQL JSON totalCost not propagated: ' + res.totalCost);
  }

  // MySQL JSON end-to-end
  if (res.engine !== 'mysql') throw new Error('MySQL JSON engine should be mysql');
  const tableStep = res.steps.find(s => s.raw.includes('Full Table Scan'));
  if (!tableStep || tableStep.target !== 'users') {
    throw new Error('MySQL JSON plan should expose a Full Table Scan on users');
  }

  // MySQL tabular end-to-end
  const tabularPlan = `+----+-------------+--------+------+---------------+------+---------+------+---------+-------------------+
| id | select_type | table  | type | possible_keys | key  | key_len | ref  | rows    | Extra             |
+----+-------------+--------+------+---------------+------+---------+------+---------+-------------------+
|  1 | SIMPLE      | users  | ALL  | NULL          | NULL | NULL    | NULL |   45000 | Using where       |
|  1 | SIMPLE      | orders | ref  | idx_orders_user| idx_orders_user | 4 | db.users.id | 3 | NULL |
+----+-------------+--------+------+---------------+------+---------+------+---------+-------------------+`;

  const tabDetection = detectFormat(tabularPlan);
  if (tabDetection.engine !== 'mysql' || tabDetection.format !== 'tabular') {
    throw new Error('Failed to detect MySQL tabular format: ' + JSON.stringify(tabDetection));
  }

  const tabResult = humanizeExplain(tabularPlan, 'mysql');
  if (tabResult.engine !== 'mysql') throw new Error('MySQL tabular engine should be mysql');
  if (tabResult.stepCount < 2) throw new Error('MySQL tabular should parse both table rows');

  const fullTableScan = tabResult.steps.find(s => s.raw.includes('Full Table Scan'));
  if (!fullTableScan || fullTableScan.target !== 'users') {
    throw new Error('MySQL tabular should identify Full Table Scan on users');
  }
  const refLookup = tabResult.steps.find(s => s.raw.includes('Index Lookup'));
  if (!refLookup || refLookup.target !== 'orders' || refLookup.node.index !== 'idx_orders_user') {
    throw new Error('MySQL tabular should identify ref lookup on orders via index');
  }

  // Error handling: malformed MySQL JSON falls back instead of crashing
  const malformed = humanizeExplain(`{ query_block: [broken `, 'mysql');
  if (malformed.verdictTitle !== 'Could Not Parse Plan' || malformed.stepCount !== 0) {
    throw new Error('Malformed MySQL JSON should return fallback analysis');
  }
}