# SQL EXPLAIN Humanizer

> **Problem & Target User:** Data analysts and junior backend engineers waste hours trying to decode cryptic, multi-page database query execution plans (`EXPLAIN` / `EXPLAIN ANALYZE`), leading to slow queries and guesswork performance fixes.

SQL EXPLAIN Humanizer parses PostgreSQL and MySQL execution plans and translates them into an intuitive, plain-English step chain with bottleneck identification and actionable indexing suggestions.

---

## 🚀 Quick Start (Single Command)

Requires Node.js (v18+ recommended):

```bash
node server.js
```

Or using npm:

```bash
npm start
```

Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🎯 Features

- **Instant Plain-English Translation**: Explains Sequential Scans, Index Scans, Hash/Nested-Loop/Merge Joins, Sorts, and Aggregates.
- **Bottleneck Spotlight**: Automatically calculates and highlights the single most expensive operation (by actual execution time or estimated cost).
- **Actionable Optimization Advice**: Provides specific advice tailored to the query's bottlenecks based on deterministic rules.
- **1-Click Demo Presets**: Includes sample query plans for instant testing (Slow Seq Scan, Join + Sort, and EXPLAIN ANALYZE).
- **Supported Inputs**:
  - **PostgreSQL**: Text EXPLAIN, JSON EXPLAIN, EXPLAIN ANALYZE, BUFFERS metrics when present.
  - **MySQL**: Traditional EXPLAIN (tabular), JSON EXPLAIN, TREE / EXPLAIN ANALYZE.
- **Zero npm Dependencies**: Plain Node.js standard-library HTTP server + vanilla JavaScript frontend. (The UI loads its font assets from Google Fonts.)

---

## 💰 Monetization Strategy

This app does **not** use paywalls, subscriptions, or login barriers. It is monetized entirely through targeted developer sponsorships and affiliate links:

1. **Top Header Sponsor Bar**: Contextual recommendation to managed database hosting (e.g., Supabase, PlanetScale) for users experiencing join/memory limits.
2. **In-Flow Affiliate Card**: Recommended database APM and slow-query monitoring tools (e.g., *pganalyze*, *PlanetScale Index Advisor*) embedded naturally directly after the query bottleneck analysis.
3. **Bottom Ad Placement**: High-intent educational sponsor link pointing to SQL & index optimization resources (*Use The Index, Luke!* / database performance courses).

---

## 🛡️ Architecture & Constraints

- **No paid API keys required**: Runs fully self-contained locally.
- **No persistent DB or Auth**: Privacy-friendly; query plans are processed by the application server and are not stored.
- **No subscription or checkout code**: Completely open and free for end-users.
