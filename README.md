<div align="center">

# Human SQL Reader

### Understand why your SQL query is slow.

**A lightweight PostgreSQL & MySQL EXPLAIN analyzer that turns execution plans into clear, evidence-based performance insights.**

<br />

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-EXPLAIN-336791?style=for-the-badge&logo=postgresql&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-EXPLAIN-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24.x-111111?style=for-the-badge&logo=nodedotjs&logoColor=5FA04E)
![Zero Dependencies](https://img.shields.io/badge/runtime_dependencies-0-111111?style=for-the-badge)
![Tests](https://img.shields.io/badge/regression_tests-included-111111?style=for-the-badge)

<br />

`PLAN PARSING` · `PERFORMANCE DIAGNOSTICS` · `DETERMINISTIC ANALYSIS` · `PLAIN ENGLISH`

</div>

---

## What is Human SQL Reader?

Database execution plans contain the information needed to understand a slow query — but they are often difficult to read unless you already know what every scan, join, cost, loop, row estimate, and buffer metric means.

**Human SQL Reader translates PostgreSQL and MySQL execution plans into a structured explanation of what happened, what looks suspicious, and what you should investigate next.**

Instead of treating every sequential scan as a problem or blindly recommending an index, the analyzer looks at the evidence available in the plan:

- rows examined vs. rows returned
- rows removed by filters
- estimated vs. actual row counts
- actual execution timing
- approximate self time vs. inclusive time
- loop amplification
- sort behavior
- buffer / I/O information
- parallel execution metadata
- access methods and selected indexes

The analysis is **deterministic and rule-based**. No LLM or external AI API decides whether a query is slow.

---

## The Goal

Human SQL Reader is built around four questions:

### 1. What happened?

> PostgreSQL scanned roughly 100,000 rows and returned 1,500.

### 2. Why might that matter?

> About 98.5% of the examined rows were discarded by a filter.

### 3. What should I investigate?

> Check whether the filtering predicate has an appropriate index and whether the column is selective enough for that index to help.

### 4. What evidence supports that conclusion?

> Rows examined, rows returned, rows removed, timing, cost, loops, and other metrics taken directly from the execution plan.

The project intentionally avoids promises such as **“this index will fix your query.”** Recommendations are phrased as things to investigate, not guarantees.

---

## Supported Inputs

### PostgreSQL

- Text `EXPLAIN`
- Text `EXPLAIN ANALYZE`
- JSON `EXPLAIN`
- JSON `EXPLAIN ANALYZE`
- `BUFFERS` metrics when present
- nested execution-plan hierarchy
- common sequential, index, bitmap, join, sort, aggregate, gather, and parallel operators

Recommended PostgreSQL input:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT ...
```

### MySQL

- traditional/tabular `EXPLAIN`
- JSON `EXPLAIN`
- TREE output
- `EXPLAIN ANALYZE`-style TREE plans
- table scans
- index lookups
- nested loops
- filesort / sorting information
- query cost when available

The format detector attempts to identify the engine and representation automatically while still allowing a dialect hint from the UI.

---

## What It Detects

The current rule engine includes diagnostics for:

| Finding | What Human SQL Reader looks for |
|---|---|
| **Sequential scan pressure** | Large scans combined with filtering/selectivity evidence |
| **Rows discarded by filters** | High ratios of examined rows that never reach the result |
| **Cardinality estimate mismatch** | Significant differences between estimated and actual rows |
| **Nested-loop amplification** | Inner operations executed repeatedly at high loop counts |
| **Sorting issues** | Expensive sorts, large sorts, filesort and spill-related evidence |
| **Buffer / I/O behavior** | Shared hits, physical reads and temporary I/O where available |
| **Parallel execution** | Planned/launched worker information and parallel operators |

A finding includes severity, confidence, supporting evidence, affected plan nodes, and a recommendation when appropriate.

---

## Why the Plan Tree Matters

Execution plans are hierarchical.

This:

```text
Sort
└── Seq Scan on event_logs
```

is not equivalent to two unrelated operations.

Parent-node timings often include work performed by their children, so simply selecting the node with the largest ending timestamp can produce misleading conclusions.

Human SQL Reader preserves the tree and tracks metrics such as:

```text
estimated rows
actual rows
loops
estimated cost
inclusive time
approximate self time
rows removed by filters
conditions
buffer metrics
children
```

Where a metric is derived rather than exact — such as approximate exclusive/self time — the application keeps that distinction explicit.

---

## Example

Input:

```text
Sort  (cost=850.12..855.12 rows=2000 width=48)
      (actual time=45.230..48.120 rows=1500 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 128kB
  ->  Seq Scan on event_logs
        (cost=0.00..720.00 rows=2000 width=48)
        (actual time=0.045..42.150 rows=1500 loops=1)
        Filter: (event_type = 'checkout_failed'::text)
        Rows Removed by Filter: 98500
Planning Time: 0.182 ms
Execution Time: 48.350 ms
```

Human SQL Reader can surface evidence such as:

```text
100,000 rows examined
1,500 rows returned
98,500 rows removed by the filter

≈ 98.5% discarded
```

Rather than automatically declaring the sequential scan wrong, it recommends investigating whether the predicate is selective and whether an appropriate index already exists.

---

## Architecture

The project deliberately stays lightweight.

```text
raw EXPLAIN plan
        │
        ▼
┌──────────────────────┐
│ format detection     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ engine parser        │
│ PostgreSQL / MySQL   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ normalized plan tree │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ metric computation   │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ deterministic rules  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ human explanation    │
└──────────────────────┘
```

### Project structure

```text
human-sql-reader/
├── humanizer.js
├── server.js
├── package.json
│
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
│
├── src/
│   ├── core/
│   │   ├── detect-format.js
│   │   ├── metrics.js
│   │   └── types.js
│   │
│   ├── parsers/
│   │   ├── postgres-text.js
│   │   ├── postgres-json.js
│   │   ├── mysql-text.js
│   │   └── mysql-json.js
│   │
│   ├── analysis/
│   │   ├── findings.js
│   │   └── rules/
│   │       ├── sequential-scans.js
│   │       ├── rows-removed.js
│   │       ├── estimate-mismatch.js
│   │       ├── nested-loop.js
│   │       ├── sorting.js
│   │       ├── io-buffers.js
│   │       └── parallel.js
│   │
│   └── explanations/
│       ├── humanize.js
│       └── node-definitions.js
│
└── tests/
    ├── detect.test.js
    ├── postgres-text.test.js
    ├── postgres-json.test.js
    ├── mysql.test.js
    ├── findings.test.js
    ├── server.test.js
    └── test-runner.js
```

---

## Tech

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-111111?style=for-the-badge&logo=javascript&logoColor=F7DF1E)
![HTML5](https://img.shields.io/badge/HTML5-Frontend-111111?style=for-the-badge&logo=html5&logoColor=E34F26)
![CSS3](https://img.shields.io/badge/CSS3-UI-111111?style=for-the-badge&logo=css3&logoColor=1572B6)
![Node.js](https://img.shields.io/badge/Node.js-Standard_Library-111111?style=for-the-badge&logo=nodedotjs&logoColor=5FA04E)

</div>

- **Node.js 24.x**
- ES modules
- vanilla HTML/CSS/JavaScript
- Node standard-library HTTP server
- **zero runtime npm dependencies**
- custom regression test runner

The lightweight stack is intentional. The interesting part of the project is the plan-analysis engine, not a framework layer around it.

---

## Quick Start

### Requirements

- Node.js **24.x**
- npm

Clone the repository:

```bash
git clone https://github.com/osaid829/human-sql-reader.git
cd human-sql-reader
```

Install:

```bash
npm install
```

There are currently no runtime dependencies, but this keeps the lockfile/environment consistent.

Start the app:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

For development:

```bash
npm run dev
```

---

## Tests

Run the full regression suite:

```bash
npm test
```

or:

```bash
npm run check
```

The suite covers:

- format detection
- PostgreSQL text plans
- PostgreSQL JSON plans
- MySQL formats
- deterministic findings
- server/error behavior

Parser changes should be accompanied by regression fixtures so a fix for one plan shape does not silently break another.

---

## Privacy

Execution plans can expose sensitive schema information such as:

- table names
- column names
- filter expressions
- literal values
- internal identifiers

Human SQL Reader does **not** persist plans to a database.

In the current architecture, the browser sends the plan to the application's `/api/humanize` endpoint, where it is parsed and analyzed in memory.

There is no external AI API or third-party plan-analysis service involved.

If you are working with highly sensitive production schemas, review the deployment environment before submitting a plan.

---

## Security

The application treats execution plans as untrusted user input.

The current implementation includes:

- safe DOM construction for plan-derived values
- no direct rendering of raw user input as executable HTML
- guarded JSON parsing
- explicit parser-failure states instead of fake metrics
- request-size protection
- malformed-request handling
- security headers in the Node server

A parser failure is reported as a failure — not silently converted into `Unknown / Cost 0 / Rows 0`.

---

## Design Principles

### Evidence before recommendations

Human SQL Reader should be able to explain *why* it produced a finding.

### A sequential scan is not automatically bad

Small tables and low-selectivity queries can make sequential scans completely reasonable.

### Estimates are not reality

When `EXPLAIN ANALYZE` provides actual values, the analyzer compares them with planner estimates rather than treating estimated cost as measured execution time.

### Parent timing is inclusive

The project does not assume every node's full runtime is independent of its children.

### No AI black box

The core diagnosis engine is deterministic, testable, and inspectable.

---

## Current Limitations

Human SQL Reader is a diagnostic assistant, not a full database optimizer.

It currently does **not**:

- connect directly to your database
- inspect existing schema/index definitions automatically
- know table cardinality beyond what the execution plan exposes
- guarantee that a suggested investigation will improve performance
- replace PostgreSQL/MySQL planner expertise for complex production workloads
- use an LLM to generate optimizations

Because index usefulness depends on schema, workload, data distribution, and selectivity, recommendations intentionally avoid pretending that a specific index is always correct.

---

## Roadmap

Some natural next steps:

- [ ] Before vs. After execution-plan comparison
- [ ] optional schema / existing-index context
- [ ] richer visual execution tree
- [ ] Simple / Developer / Advanced explanation modes
- [ ] anonymized report export
- [ ] local plan history
- [ ] browser-side analysis / Web Worker mode
- [ ] more PostgreSQL and MySQL operator coverage

---

## Why I Built It

Execution plans are one of those developer tools where the information is technically all there, but understanding it can take longer than finding the slow query in the first place.

I wanted to build something that sits between:

> “Here is a wall of database planner output.”

and:

> “Trust this magic optimization score.”

Human SQL Reader keeps the underlying metrics visible while translating them into language that is easier to reason about.

It is also an experiment in building a useful developer tool without relying on an AI API, a database, authentication, or a large application framework.

---

## Contributing

Issues and focused pull requests are welcome.

For parser changes, please include a representative execution-plan fixture and a regression test whenever possible.

Keep recommendations evidence-based and avoid turning planner heuristics into absolute rules.

---

<div align="center">

## Human SQL Reader

**From execution plan → evidence → explanation.**

<br />

[Repository](https://github.com/osaid829/human-sql-reader) ·
[GitHub Profile](https://github.com/osaid829)

<br /><br />

Built by **Osaid**

</div>
