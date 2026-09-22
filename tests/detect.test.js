// tests/detect.test.js — format & engine detection matrix, error fallbacks
import { detectFormat } from '../src/core/detect-format.js';
import { humanizeExplain } from '../humanizer.js';

function expect(format, engine, formatName) {
  const detection = detectFormat(format);
  if (detection.engine !== engine || detection.format !== formatName) {
    throw new Error(
      `Expected ${engine}/${formatName} for plan, got ${detection.engine}/${detection.format}\n----\n${format}`
    );
  }
}

export default async function run() {
  // PostgreSQL text (no actuals)
  expect(
    `Seq Scan on orders  (cost=0.00..45823.00 rows=125430 width=72)`,
    'postgresql', 'text'
  );

  // PostgreSQL text with EXPLAIN ANALYZE actuals
  expect(
    `Sort  (cost=850.12..855.12 rows=2000 width=48) (actual time=45.230..48.120 rows=1500 loops=1)
  Sort Key: created_at DESC
  ->  Seq Scan on event_logs  (cost=0.00..720.00 rows=2000 width=48) (actual time=0.045..42.150 rows=1500 loops=1)`,
    'postgresql', 'text'
  );

  // PostgreSQL JSON
  expect(
    `[{"Plan":{"Node Type":"Seq Scan","Relation Name":"users","Total Cost":10}}]`,
    'postgresql', 'json'
  );

  // PostgreSQL plan with arrows + Nested Loop + Filter must NOT be MySQL
  expect(
    `Nested Loop  (cost=0.00..1.12 rows=24 width=8)
  ->  Seq Scan on a  (cost=0.00..0.35 rows=10 width=4)
        Filter: (a.id > 10)
        Rows Removed by Filter: 9000
  ->  Index Scan using b_pkey on b  (cost=0.00..0.31 rows=1 width=4)`,
    'postgresql', 'text'
  );

  // MySQL tabular
  expect(
    `| id | select_type | table | type | possible_keys | key | key_len | ref | rows | Extra |
|  1 | SIMPLE      | users | ALL  | NULL          | NULL| NULL    | NULL| 45000| Using where |`,
    'mysql', 'tabular'
  );

  // MySQL JSON
  expect(
    `{"query_block":{"select_id":1,"table":{"table_name":"users","access_type":"ALL"}}}`,
    'mysql', 'json'
  );

  // MySQL TREE with PG-style (actual time=...) blocks — must win over PostgreSQL
  expect(
    `-> Nested loop inner join  (cost=1.75..1043.21 rows=99) (actual time=0.031..7.553 rows=99 loops=1)
      -> Table scan on t2  (cost=0.35..2.16 rows=288) (actual time=0.018..0.070 rows=288 loops=1)
      -> Index lookup on t1 using PRIMARY (t1.a=t2.a)  (cost=0.70..0.94 rows=1) (actual time=0.036..0.039 rows=1 loops=1)`,
    'mysql', 'tree'
  );

  // MySQL TREE pasted with leading indentation must still be detected
  expect(
    `    -> Filter: (country = 'US')  (cost=0.35..2.16 rows=3) (actual time=0.036..0.061 rows=3 loops=1)
        -> Table scan on customers  (cost=0.02..2.16 rows=288) (actual time=0.018..0.070 rows=288 loops=1)`,
    'mysql', 'tree'
  );

  // Unknown / plain SQL
  const unknown = detectFormat(`SELECT * FROM users WHERE id = 1;`);
  if (unknown.engine !== 'unknown') {
    throw new Error('Plain SQL should be unknown, got ' + JSON.stringify(unknown));
  }

  // ── Error handling: malformed JSON must fall back, never throw ───────────
  const pgFallback = humanizeExplain(`{ "Plan": { bad `, 'postgres');
  if (pgFallback.verdictTitle !== 'Could Not Parse Plan' || pgFallback.stepCount !== 0) {
    throw new Error('Postgres malformed JSON should return fallback analysis');
  }
  if (pgFallback.story.includes('MySQL')) {
    throw new Error('Postgres fallback story must not mention MySQL');
  }

  const myFallback = humanizeExplain(`{ query_block: oops `, 'mysql');
  if (myFallback.verdictTitle !== 'Could Not Parse Plan' || myFallback.stepCount !== 0) {
    throw new Error('MySQL malformed JSON should return fallback analysis');
  }
}