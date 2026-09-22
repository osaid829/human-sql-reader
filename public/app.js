// app.js — Frontend client logic

const PRESETS = {
  slow: `Seq Scan on orders  (cost=0.00..45823.00 rows=125430 width=72)
  Filter: ((created_at >= '2023-01-01'::date) AND (status = 'pending'::text))
  Rows Removed by Filter: 874570`,

  pgJson: `[
  {
    "Plan": {
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      "Startup Cost": 0.00,
      "Total Cost": 1834.00,
      "Plan Rows": 100000,
      "Plan Width": 36,
      "Filter": "((created_at >= '2023-01-01'::date) AND (status = 'pending'::text))",
      "Rows Removed by Filter": 874570
    }
  }
]`,

  mysqlTabular: `+----+-------------+--------+------------+------+---------------+-------------+---------+-------------------+-------+----------+-----------------------------+
| id | select_type | table  | partitions | type | possible_keys | key         | key_len | ref               | rows  | filtered | Extra                       |
+----+-------------+--------+------------+------+---------------+-------------+---------+-------------------+-------+----------+-----------------------------+
|  1 | SIMPLE      | orders | NULL       | ALL  | NULL          | NULL        | NULL    | NULL              | 45000 |   100.00 | Using where; Using filesort |
|  1 | SIMPLE      | users  | NULL       | ref  | idx_users_id  | idx_users_id| 4       | db.orders.user_id |     1 |   100.00 | NULL                        |
+----+-------------+--------+------------+------+---------------+-------------+---------+-------------------+-------+----------+-----------------------------+`,

  mysqlJson: JSON.stringify({
    query_block: {
      select_id: 1,
      cost_info: { query_cost: "1240.00" },
      ordering_operation: {
        using_filesort: true,
        nested_loop: [
          {
            table: {
              table_name: "customers",
              access_type: "ALL",
              rows_examined_per_scan: 50000,
              rows_produced_per_join: 5000,
              filtered: "10.00",
              cost_info: { eval_cost: "500.00" },
              used_columns: ["id", "name", "country"],
              attached_condition: "(`customers`.`country` = 'US')"
            }
          },
          {
            table: {
              table_name: "orders",
              access_type: "ref",
              possible_keys: ["idx_orders_customer_id"],
              key: "idx_orders_customer_id",
              used_key_parts: ["customer_id"],
              key_length: "4",
              ref: ["testdb.customers.id"],
              rows_examined_per_scan: 3,
              rows_produced_per_join: 15000,
              filtered: "100.00"
            }
          }
        ]
      }
    }
  }, null, 2),

  join: `Sort  (cost=1230.45..1235.45 rows=2000 width=64)
  Sort Key: u.created_at DESC
  ->  Hash Join  (cost=45.20..1120.30 rows=2000 width=64)
        Hash Cond: (o.user_id = u.id)
        ->  Seq Scan on orders o  (cost=0.00..850.00 rows=25000 width=32)
        ->  Hash  (cost=30.00..30.00 rows=1000 width=32)
              ->  Index Scan using users_pkey on users u  (cost=0.28..30.00 rows=1000 width=32)`,

  analyze: `Sort  (cost=850.12..855.12 rows=2000 width=48) (actual time=45.230..48.120 rows=1500 loops=1)
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 128kB
  ->  Seq Scan on event_logs  (cost=0.00..720.00 rows=2000 width=48) (actual time=0.045..42.150 rows=1500 loops=1)
        Filter: (event_type = 'checkout_failed'::text)
        Rows Removed by Filter: 98500
Planning Time: 0.182 ms
Execution Time: 48.350 ms`
};

// DOM references
const planInput = document.getElementById("planInput");
const dialectSelect = document.getElementById("dialectSelect");
const humanizeBtn = document.getElementById("humanizeBtn");
const outputEmpty = document.getElementById("outputEmpty");
const outputResults = document.getElementById("outputResults");
const verdictCard = document.getElementById("verdictCard");
const verdictTitle = document.getElementById("verdictTitle");
const verdictMeta = document.getElementById("verdictMeta");
const verdictStory = document.getElementById("verdictStory");
const bottleneckCard = document.getElementById("bottleneckCard");
const bottleneckDesc = document.getElementById("bottleneckDesc");
const bottleneckTip = document.getElementById("bottleneckTip");
const stepsList = document.getElementById("stepsList");
const themeToggle = document.getElementById("themeToggle");

// Presets
document.getElementById("btnPresetPgJson").addEventListener("click", () => {
  dialectSelect.value = "postgres";
  planInput.value = PRESETS.pgJson;
  runAnalysis();
});
document.getElementById("btnPresetSlow").addEventListener("click", () => {
  dialectSelect.value = "postgres";
  planInput.value = PRESETS.slow;
  runAnalysis();
});
document.getElementById("btnPresetAnalyze").addEventListener("click", () => {
  dialectSelect.value = "postgres";
  planInput.value = PRESETS.analyze;
  runAnalysis();
});
document.getElementById("btnPresetMysqlTab").addEventListener("click", () => {
  dialectSelect.value = "mysql";
  planInput.value = PRESETS.mysqlTabular;
  runAnalysis();
});
document.getElementById("btnPresetMysqlJson").addEventListener("click", () => {
  dialectSelect.value = "mysql";
  planInput.value = PRESETS.mysqlJson;
  runAnalysis();
});

// Submit button
humanizeBtn.addEventListener("click", runAnalysis);

// Theme toggle
let isDark = false;
themeToggle.addEventListener("click", () => {
  isDark = !isDark;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
});

async function runAnalysis() {
  const plan = planInput.value.trim();
  if (!plan) {
    alert("Please paste a query plan or click one of the preset buttons.");
    return;
  }

  humanizeBtn.disabled = true;
  humanizeBtn.innerHTML = `<span>Analyzing...</span>`;

  try {
    const res = await fetch("/api/humanize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        dialect: dialectSelect.value,
      }),
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const data = await res.json();
    renderAnalysis(data);
  } catch (err) {
    alert("Failed to analyze plan: " + err.message);
  } finally {
    humanizeBtn.disabled = false;
    humanizeBtn.innerHTML = `<span>Humanize Plan</span> <span>&rarr;</span>`;
  }
}

function renderAnalysis(data) {
  outputEmpty.style.display = "none";
  outputResults.style.display = "block";

  // 1. Verdict Card
  verdictCard.className = `card verdict-header ${data.verdictType || "info"}`;
  verdictTitle.textContent = data.verdictTitle;

  if (data.hasActual && data.totalTime) {
    verdictMeta.textContent = `${data.stepCount} steps • Total Time: ${data.totalTime.toFixed(2)} ms`;
  } else {
    verdictMeta.textContent = `${data.stepCount} steps • Total Cost: ${data.totalCost.toLocaleString()}`;
  }

  // Parse simple markdown bold **text** in story safely
  verdictStory.textContent = "";
  const parts = data.story.split(/(\*\*.*?\*\*|`.*?`)/g);
  parts.forEach(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      verdictStory.appendChild(strong);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      verdictStory.appendChild(code);
    } else {
      verdictStory.appendChild(document.createTextNode(part));
    }
  });

  // 2. Bottleneck Card
  if (data.bottleneck) {
    bottleneckCard.style.display = "flex";
    
    bottleneckDesc.textContent = "";
    const bStrong = document.createElement("strong");
    bStrong.textContent = data.bottleneck.label;
    bottleneckDesc.appendChild(bStrong);
    
    if (data.bottleneck.target) {
      bottleneckDesc.appendChild(document.createTextNode(" on relation "));
      const bCode = document.createElement("code");
      bCode.textContent = data.bottleneck.target;
      bottleneckDesc.appendChild(bCode);
    }
    
    if (data.bottleneck.actualTime) {
      bottleneckDesc.appendChild(document.createTextNode(" took "));
      const bTime = document.createElement("strong");
      bTime.textContent = `${data.bottleneck.actualTime.toFixed(2)} ms`;
      bottleneckDesc.appendChild(bTime);
    } else if (data.bottleneck.cost) {
      bottleneckDesc.appendChild(document.createTextNode(" with estimated cost "));
      const bCost = document.createElement("strong");
      bCost.textContent = data.bottleneck.cost.toLocaleString();
      bottleneckDesc.appendChild(bCost);
    }

    bottleneckTip.textContent = `💡 Optimization Tip: ${data.bottleneck.tip}`;
  } else {
    bottleneckCard.style.display = "none";
  }

  // 3. Step Chain List (Safe DOM Construction)
  stepsList.textContent = "";
  
  // Also render issues/findings if present
  if (data.issues && data.issues.length > 0) {
     const findingsHeading = document.createElement("div");
     findingsHeading.className = "chain-heading";
     findingsHeading.textContent = "Findings & Recommendations";
     stepsList.appendChild(findingsHeading);
     
     data.issues.forEach(issue => {
        const fCard = document.createElement("div");
        fCard.className = `step-card severity-${issue.severity}`;
        
        const fHeader = document.createElement("div");
        fHeader.className = "step-card-header";
        const fTitle = document.createElement("span");
        fTitle.className = "step-title";
        fTitle.textContent = issue.title;
        const fBadge = document.createElement("span");
        fBadge.className = `step-badge ${issue.severity}`;
        fBadge.textContent = issue.severity.toUpperCase();
        
        fHeader.appendChild(fTitle);
        fHeader.appendChild(fBadge);
        fCard.appendChild(fHeader);
        
        const fSummary = document.createElement("p");
        fSummary.className = "step-summary";
        fSummary.textContent = issue.summary;
        fCard.appendChild(fSummary);

        if (issue.evidence && issue.evidence.length > 0) {
            const fEvidence = document.createElement("div");
            fEvidence.className = "mono";
            fEvidence.style.cssText = "font-size:0.75rem; background:var(--panel); padding:0.4rem 0.6rem; border-radius:4px; margin-top:0.4rem; color:var(--ink); line-height: 1.4;";
            
            const fEvidTitle = document.createElement("strong");
            fEvidTitle.textContent = "Evidence";
            fEvidTitle.style.display = "block";
            fEvidTitle.style.marginBottom = "0.2rem";
            fEvidence.appendChild(fEvidTitle);

            issue.evidence.forEach(ev => {
                const line = document.createElement("div");
                line.textContent = `${ev.value} ${ev.label.toLowerCase()}`;
                fEvidence.appendChild(line);
            });
            fCard.appendChild(fEvidence);
        }
        
        if (issue.recommendation) {
            const fRec = document.createElement("div");
            fRec.className = "step-tip";
            fRec.textContent = `💡 Recommendation: ${issue.recommendation}`;
            fCard.appendChild(fRec);
        }
        
        stepsList.appendChild(fCard);
     });
     
     const execHeading = document.createElement("div");
     execHeading.className = "chain-heading";
     execHeading.style.marginTop = "1.5rem";
     execHeading.textContent = "Execution Steps";
     stepsList.appendChild(execHeading);
  }

  data.steps.forEach((step, index) => {
    const card = document.createElement("div");
    card.className = `step-card severity-${step.severity || "info"}`;

    const header = document.createElement("div");
    header.className = "step-card-header";
    
    const titleWrap = document.createElement("div");
    titleWrap.className = "step-title-wrap";
    
    const num = document.createElement("span");
    num.className = "step-num";
    num.textContent = index + 1;
    
    const title = document.createElement("span");
    title.className = "step-title";
    title.textContent = `${step.label} `;
    if (step.target) {
      const code = document.createElement("code");
      code.style.fontWeight = "normal";
      code.style.fontSize = "0.85rem";
      code.textContent = step.target;
      title.appendChild(code);
    }
    
    titleWrap.appendChild(num);
    titleWrap.appendChild(title);
    header.appendChild(titleWrap);
    
    const badge = document.createElement("span");
    badge.className = `step-badge ${step.severity}`;
    badge.textContent = step.severity.toUpperCase();
    header.appendChild(badge);
    
    card.appendChild(header);

    const summary = document.createElement("p");
    summary.className = "step-summary";
    summary.textContent = step.summary;
    card.appendChild(summary);

    if (step.details && step.details.length > 0) {
      const details = document.createElement("div");
      details.className = "mono";
      details.style.cssText = "font-size:0.75rem; background:var(--panel); padding:0.4rem 0.6rem; border-radius:4px; margin-top:0.4rem; color:var(--ink);";
      for (const d of step.details) {
        const line = document.createElement("div");
        line.textContent = d;
        details.appendChild(line);
      }
      card.appendChild(details);
    }

    const metrics = document.createElement("div");
    metrics.className = "step-metrics";
    
    const metricItems = [
      { label: "Est. Cost:", val: step.cost.toLocaleString() },
      { label: "Est. Rows:", val: step.rowsEst.toLocaleString() }
    ];
    if (step.actualTime !== null) metricItems.push({ label: "Actual Time:", val: `${step.actualTime.toFixed(2)} ms` });
    if (step.actualRows !== null) metricItems.push({ label: "Actual Rows:", val: step.actualRows.toLocaleString() });
    
    metricItems.forEach(item => {
      const span = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = item.label;
      span.appendChild(strong);
      span.appendChild(document.createTextNode(` ${item.val}`));
      metrics.appendChild(span);
    });
    
    card.appendChild(metrics);

    if (step.tip) {
      const tip = document.createElement("div");
      tip.className = "step-tip";
      tip.textContent = `💡 Why & Fix: ${step.why || ""} ${step.tip}`;
      card.appendChild(tip);
    }

    stepsList.appendChild(card);
  });
}
