// tests/findings.test.js — findings engine rule coverage
import { createPlanNode, flattenTree, resetNodeIds } from '../src/core/types.js';
import { generateFindings } from '../src/analysis/findings.js';

export default async function run() {
  // ── Rows removed (high) ──────────────────────────────────────────────────
  resetNodeIds();
  const seq = createPlanNode({
    engine: 'postgresql',
    operation: 'Seq Scan',
    relation: 'orders',
    estimatedRows: 125430,
    rowsRemovedByFilter: 874570,
  });
  let findings = generateFindings(flattenTree(seq));
  let f = findings.find(x => x.id === `rows-removed-${seq.id}`);
  if (!f || f.severity !== 'high') throw new Error('rows-removed finding missing or wrong severity');
  const rrLabels = f.evidence.map(e => e.label.toLowerCase()).join(' ');
  if (!rrLabels.includes('estimated rows') || !rrLabels.includes('removed')) {
    throw new Error('rows-removed finding should carry estimated/removed evidence');
  }
  if (rrLabels.includes('actual rows returned')) {
    throw new Error('rows-removed must not label estimated rows as actual rows returned');
  }
  if (rrLabels.includes('rows examined')) {
    throw new Error('rows-removed must not calculate rows examined without actualRows');
  }
  if (rrLabels.includes('discard ratio')) {
    throw new Error('rows-removed must not calculate discard ratio without actualRows');
  }

  // ── Rows removed with real EXPLAIN ANALYZE metrics ────────────────────────
  resetNodeIds();
  const analyzedSeq = createPlanNode({
    engine: 'postgresql',
    operation: 'Seq Scan',
    relation: 'event_logs',
    estimatedRows: 2000,
    actualRows: 1500,
    rowsRemovedByFilter: 98500,
  });
  const analyzedFindings = generateFindings(flattenTree(analyzedSeq));
  f = analyzedFindings.find(x => x.id === `rows-removed-${analyzedSeq.id}`);
  if (!f) {
    throw new Error('rows-removed finding should exist for actual EXPLAIN ANALYZE metrics');
  }
  const analyzedEvidence = Object.fromEntries(f.evidence.map(e => [e.label, e.value]));
  if (analyzedEvidence['Actual Rows Returned'] !== '1,500') {
    throw new Error('Actual Rows Returned should use actualRows');
  }
  if (analyzedEvidence['Rows Examined'] !== '100.0K') {
    throw new Error(`Expected 100.0K rows examined, got ${analyzedEvidence['Rows Examined']}`);
  }
  if (analyzedEvidence['Discard Ratio'] !== '98.5%') {
    throw new Error(`Expected 98.5% discard ratio, got ${analyzedEvidence['Discard Ratio']}`);
  }

  // ── Estimate mismatch (medium) ───────────────────────────────────────────
  resetNodeIds();
  const scan = createPlanNode({
    engine: 'postgresql',
    operation: 'Index Scan',
    relation: 't',
    estimatedRows: 1000,
    actualRows: 50000,
  });
  f = generateFindings(flattenTree(scan)).find(x => x.id === `estimate-mismatch-${scan.id}`);
  if (!f || f.severity !== 'medium') throw new Error('estimate-mismatch finding missing or wrong severity');
  const emLabels = f.evidence.map(e => e.label.toLowerCase()).join(' ');
  if (!emLabels.includes('estimated rows') || !emLabels.includes('actual rows')) {
    throw new Error('estimate-mismatch should carry estimated/actual rows evidence');
  }

  // ── Sequential scan with high filter discard (high) ──────────────────────
  f = findings.find(x => x.id === `seq-scan-filter-${seq.id}`);
  if (!f || f.severity !== 'high') throw new Error('seq-scan-filter finding missing or wrong severity');

  // ── Large sequential scan (medium) ───────────────────────────────────────
  resetNodeIds();
  const largeSeq = createPlanNode({
    engine: 'postgresql',
    operation: 'Seq Scan',
    relation: 'audit',
    estimatedRows: 200000,
  });
  f = generateFindings(flattenTree(largeSeq)).find(x => x.id === `seq-scan-large-${largeSeq.id}`);
  if (!f || f.severity !== 'medium') throw new Error('seq-scan-large finding missing or wrong severity');
  const estimatedLabels = f.evidence.map(e => e.label.toLowerCase()).join(' ');
  if (!estimatedLabels.includes('estimated rows')) {
    throw new Error('estimated-only sequential scan should say Estimated Rows');
  }
  if (estimatedLabels.includes('actual rows returned')) {
    throw new Error('estimated-only sequential scan must not claim actual returned rows');
  }

  // ── Nested loop amplification (medium) ───────────────────────────────────
  resetNodeIds();
  const nl = createPlanNode({
    engine: 'postgresql',
    operation: 'Nested Loop',
    children: [
      createPlanNode({ engine: 'postgresql', operation: 'Seq Scan', estimatedRows: 20000 }),
      createPlanNode({ engine: 'postgresql', operation: 'Index Scan', index: 'i', estimatedRows: 1 }),
    ],
  });
  f = generateFindings(flattenTree(nl)).find(x => x.id === `nested-loop-amplification-${nl.id}`);
  if (!f || f.severity !== 'medium') throw new Error('nested-loop-amplification finding missing');

  // ── Disk sort spill (high) ───────────────────────────────────────────────
  resetNodeIds();
  const sort = createPlanNode({
    engine: 'postgresql',
    operation: 'Sort',
    sortMethod: 'external merge',
    sortSpaceUsedKb: 204800,
    sortSpaceType: 'Disk',
  });
  f = generateFindings(flattenTree(sort)).find(x => x.id === `sort-spill-${sort.id}`);
  if (!f || f.severity !== 'high') throw new Error('sort-spill finding missing or wrong severity');
  const spill = f.evidence.find(e => e.label === 'Space Used');
  if (!spill || spill.value !== '204800 kB') throw new Error('sort-spill evidence missing');

  // ── MySQL full scan (warning) ────────────────────────────────────────────
  resetNodeIds();
  const myScan = createPlanNode({
    engine: 'mysql',
    operation: 'Full Table Scan',
    relation: 'users',
    estimatedRows: 45000,
  });
  f = generateFindings(flattenTree(myScan)).find(x => x.id === `mysql-full-scan-${myScan.id}`);
  if (!f || f.severity !== 'warning') throw new Error('mysql-full-scan finding missing or wrong severity');

  // ── Temporary storage I/O (high) ─────────────────────────────────────────
  resetNodeIds();
  const sort2 = createPlanNode({
    engine: 'postgresql',
    operation: 'Sort',
    tempReadBlocks: 100,
    tempWrittenBlocks: 50,
  });
  f = generateFindings(flattenTree(sort2)).find(x => x.id === `temp-io-${sort2.id}`);
  if (!f || f.severity !== 'high') throw new Error('temp-io finding missing');

  // ── Low buffer cache hit ratio (medium) ──────────────────────────────────
  resetNodeIds();
  const io = createPlanNode({
    engine: 'postgresql',
    operation: 'Seq Scan',
    sharedReadBlocks: 8000,
    sharedHitBlocks: 2000,
  });
  f = generateFindings(flattenTree(io)).find(x => x.id === `low-cache-hit-${io.id}`);
  if (!f || f.severity !== 'medium') throw new Error('low-cache-hit finding missing');

  // ── Parallel workers limited (low) ───────────────────────────────────────
  resetNodeIds();
  const gather = createPlanNode({
    engine: 'postgresql',
    operation: 'Gather',
    workersPlanned: 4,
    workersLaunched: 2,
  });
  f = generateFindings(flattenTree(gather)).find(x => x.id === `parallel-workers-${gather.id}`);
  if (!f || f.severity !== 'low') throw new Error('parallel-workers finding missing');

  // ── Consolidation: severities sorted (critical/high first) ───────────────
  resetNodeIds();
  const mixedRoot = createPlanNode({
    engine: 'postgresql',
    operation: 'Sort',
    children: [
      createPlanNode({
        engine: 'postgresql',
        operation: 'Seq Scan',
        relation: 'x',
        estimatedRows: 30000,
        rowsRemovedByFilter: 870000,
      }),
    ],
  });
  const mixed = generateFindings(flattenTree(mixedRoot));
  if (mixed.length === 0) throw new Error('Mixed plan should produce findings');
  if (!['high', 'critical'].includes(mixed[0].severity)) {
    throw new Error('Findings should be sorted with high severity first, got ' + mixed[0].severity);
  }

  // ── Empty input should be safe ───────────────────────────────────────────
  if (generateFindings([]).length !== 0) throw new Error('Empty findings input should be safe');
}