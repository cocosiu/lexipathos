# LexiPathOS

## Overview

LexiPathOS is a **DuckDB**-based semantic query engine that uses a unified JSON DSL to query any structured data in natural semantics, without writing SQL or understanding underlying table relationships.

**Core Capabilities:**
- Automatic multi-table JOIN path inference (Dijkstra weighted optimal path)
- Enum value auto-translation (internal codes → human-readable display)
- In-memory computation (flat processing, pivot matrices)
- Unified response format (rows + flat + matrix)

> The code in this repository uses **office leasing (commercial real estate)** business data as a demonstration case. The tables involved (contracts, units, tenants, bills, etc.) are business data structures from that domain — **they are not the engine's standard**. Switching to another industry only requires replacing the data dictionary and business configuration; the engine code remains untouched.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Client                          │
│         Send DSL JSON → Receive rows/flat/matrix  │
└──────────────────┬──────────────────────────────┘
                   │ POST /api/report/execute
                   ▼
┌─────────────────────────────────────────────────┐
│               Routes / Middleware                │
│        Validate → Call Engine → Serialize        │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│              ReportBuilder (Core Engine)         │
│                                                 │
│  1. loadFromJson(json)  ← Parse DSL             │
│  2. autoGenerateJoins()  ← ResourceGraph path    │
│  3. buildSQL()  ← Generate SQL                  │
│  4. execute()  ← DuckDB run + totals            │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│           ResourceGraph (Relationship Graph)     │
│                                                 │
│  - Multi-table foreign key definitions          │
│  - Dijkstra weighted shortest path search       │
│  - Auto-fill intermediary tables + aliasing     │
│  - Mermaid export for visualization             │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│         Mapper + MatrixUtil (Post-processing)    │
│                                                 │
│  - applyEnumMappings: codes → human-readable     │
│  - ReportMatrixUtil: SQL rows → flat + matrix    │
│  - calcFnForMatrix: in-memory JS processing      │
│  - combinedDims: multi-field column merging      │
└─────────────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│               Response Format                    │
│                                                 │
│  {                                              │
│    success: true,                               │
│    rows: [...],      ← Raw SQL results          │
│    matrix: {...},    ← Pivot matrix             │
│    flat: [...],      ← Flattened data           │
│    total: N,         ← Row count                │
│    sql: "...",       ← Generated SQL (debug)    │
│    combinedInfo: []  ← Merged column info        │
│  }                                              │
└─────────────────────────────────────────────────┘
```

---

## Operating Mechanism

### Deploy Time: ER Diagram → Queryable Graph

During deployment, based on the business ER diagram, **select relevant tables and relationship edges** and organize them into `resourceDictionary`, forming the engine's **queryable graph**.

```
ER Diagram (Business Modeling)
    │
    ▼ Select on demand
resourceDictionary (Queryable Graph)
    ├── Table definitions (name, field labels, aliases)
    └── Edge definitions (relations: foreign key links)
```

This queryable graph defines **what the engine can query** — the upper bound of the query scope. The engine will never navigate beyond this scope.

> `resourceDictionary` is the only part of the engine that needs business-specific customization. When switching industries, simply re-orchestrate this dictionary based on the new ER diagram — zero engine code changes.

---

### Runtime: Prune → Subgraph → Route

Each query request does not load the entire queryable graph. Instead, it follows this flow:

```
Request (dataSources: [contracts, buildings])
    │
    ▼ Step 1: Extract entry tables
Extract starting tables from dataSources
    │
    ▼ Step 2: Pruning
In the queryable graph (resourceDictionary),
keep only edges related to starting tables, trim irrelevant branches
    │
    ▼ Step 3: Fill intermediary tables
Run Dijkstra on the pruned subgraph,
auto-fill tables needed for the path
    │
    ▼ Step 4: Generate Runtime subgraph
Lock closure subgraph → Assign table aliases → Build JOIN chain
    │
    ▼ Step 5: Execute
Assemble SQL → DuckDB execution → Post-processing (enum translation, pivot)
    │
    ▼ Return results
```

Key points:

- **Queryable graph** is defined by `resourceDictionary` at deploy time — static
- **Runtime subgraph** is determined by each request's `dataSources` — dynamically pruned
- **Auto-fill intermediary tables** — e.g., querying contracts and buildings, the engine auto-finds contract_units → units as bridges
- **Pruning prevents cycles** — subgraphs contain only 3~6 tables in closure, never dragging the full graph into one query

```
┌─────────────────────────────────────────────┐
│  Deploy Time (Static)                        │
│                                              │
│  ER Diagram → resourceDictionary (Queryable) │
│             All tables & edges               │
└──────────────────┬──────────────────────────┘
                   │ Runtime pruning
                   ▼
┌─────────────────────────────────────────────┐
│  Runtime (Dynamic)                           │
│                                              │
│  dataSources → Subgraph (closure) → Dijkstra │
│  Each request independent                    │
└─────────────────────────────────────────────┘
```

---

## Data Sources

On startup, the engine reads business data from MySQL into DuckDB's in-memory database via `dataLoader`. Every startup performs a full load of all data sources; incremental sync is also available via API.

```
Startup request
    │
    ▼
dataLoader connects MySQL (configured via env vars)
    │
    ├── Read dataSource config (table mappings)
    ├── Loop through each table
    │   ├── Read MySQL table structure (column names + types)
    │   ├── Auto type mapping (INT→BIGINT, DECIMAL→DOUBLE, DATE→TIMESTAMP, etc.)
    │   ├── DROP + CREATE to rebuild DuckDB table
    │   └── Batch INSERT (1000 rows per batch)
    │
    ▼
DuckDB in-memory ready, awaiting DSL queries
```

### MySQL Connection Config

| Env Variable | Description |
|---|---|
| `MYSQL_HOST` | MySQL server address |
| `MYSQL_USER` | Database username |
| `MYSQL_PASSWORD` | Database password |
| `MYSQL_DATABASE` | Database name |

### Incremental Sync

`POST /api/incremental` syncs specific data sources incrementally. Accepts `{ dataSource, lastUpdated }` and only pulls data after the given timestamp.

> Since DuckDB uses `:memory:` mode, **data is lost on restart**. The engine automatically reloads from MySQL on startup.

---

## DSL Reference

### Full Structure

```json
{
  "dataSources": [
    {"table": "table1"},
    {"table": "table2"}
  ],
  "rowDims": [
    "table.field",
    {"alias": "alias", "field": "table.field"},
    {"alias": "alias", "field": "table.field", "groupBy": false}
  ],
  "metrics": [
    {"field": "table.field", "agg": "SUM|COUNT|AVG|MAX|MIN", "alias": "alias"},
    {"field": "table.field", "agg": "COUNT", "alias": "count_alias", "condition": {"field": "table.field", "op": "=", "value": "value"}},
    {"alias": "alias", "calcFnForMatrix": "(flat) => { /* JS */ }"}
  ],
  "filters": [
    {"field": "table.field", "op": "=", "value": "value"},
    {"field": "table.field", "op": "IN", "value": ["val1", "val2"]},
    {"field": "table.field", "op": "BETWEEN", "value": ["start", "end"]},
    {"field": "table.field", "op": "LIKE", "value": "pattern"},
    {"field": "table.field", "op": "IS", "value": null}
  ],
  "orderBy": {"field": "table.field", "direction": "ASC|DESC"},
  "orderBy": [{"field": "field1", "direction": "ASC"}, {"field": "field2", "direction": "DESC"}],
  "combinedDims": [
    {"alias": "combined_name", "fields": ["alias1", "alias2"], "combineWith": "separator"}
  ],
  "totalEnabled": true,
  "limit": 100
}
```

### Parameter Reference

| Param | Type | Required | Description |
|---|---|---|---|
| `dataSources` | `[{table}]` | ✅ | Table list; only need starting tables, API auto-fills intermediaries |
| `rowDims` | `[string\|object]` | ❌ | Row dimensions. string=`"table.field"`, object=`{alias, field, groupBy?}` |
| `metrics` | `[object]` | ❌ | Aggregate metrics. `{field, agg, alias}` or `{alias, calcFnForMatrix}` |
| `filters` | `[object]` | ❌ | Filter conditions. `{field, op, value}` |
| `orderBy` | `object\|array` | ❌ | Sort: single field object or multi-field array |
| `combinedDims` | `[object]` | ❌ | Combined dimension display |
| `totalEnabled` | `boolean` | ❌ | Append summary row |
| `limit` | `number` | ❌ | Max rows returned, default 100 |

### Operators

| Operator | Usage |
|---|---|
| `=` | Equals |
| `!=` | Not equals |
| `>` / `<` | Greater than / Less than |
| `>=` / `<=` | Greater or equal / Less or equal |
| `LIKE` | Pattern matching (supports `%` wildcard) |
| `BETWEEN` | Range match, value is `[start, end]` |
| `IN` | List match, value is an **array** `["a", "b"]` |
| `IS` | Null check, value is `null` |

---

## Core Mechanisms

### 1. Automatic JOIN Inference

**No need to hand-write relationships!** Just list the tables you care about in `dataSources`, and the engine will:

1. Look up the shortest weighted path between tables in **ResourceGraph**
2. Auto-fill intermediary tables (e.g., contracts → contract_units → units → buildings)
3. Assign non-conflicting table aliases
4. Generate the complete JOIN chain

Path weight design (**preset but not yet active** — retained for edge cases with few nodes but compound paths):
- **belongs_to / has_many** main path: weight 1.0
- **Many-to-many** intermediary: weight +0.5
- **System auxiliary tables** (creator/updater): weight +5.0
- **Reverse paths**: weight +0.1 penalty

**Table count limit: depends on graph quality, no hard limit from the engine**

How many tables can be JOINed depends on how well the graph is configured, not the engine's capability. Three key constraints:

| Constraint | Description |
|---|---|
| **Edges must connect** | Tables in a query must have a reachable path. Missing intermediaries are auto-filled, but if start and end are disconnected, an error is thrown |
| **No cycles** | One-way edges only; never declare the same relationship bidirectionally. Cycles cause Dijkstra infinite loops or path ambiguity |
| **No Cartesian risk** | Long `one_to_many` chains cause row explosion (1 contract × 10 periods × 5 bills = 50 rows). Direct `many_to_many` associations are high-risk — always bridge via intermediary tables |

Otherwise, table count is practically only limited by DuckDB's performance — multiple tables can theoretically work as long as the graph is clean.

### 2. Enum Auto-Translation

Internal storage uses English codes; responses auto-translate to human-readable text; filters use English codes.

Example: `units.status` stores `"vacant"`:
- Filter: `"value": "vacant"`
- Response displays: `"Vacant"` (or localized equivalent)

Full mappings are defined in `values_mapping.js`, registered by `{table}.{field}`.

### 3. Dual Output Modes

| Format | Source | Usage |
|---|---|---|
| `rows` | Direct SQL results | Raw data display |
| `flat` | Flattened rows array | Input/output for calcFnForMatrix |
| `matrix` | Nested object from flat | Pivot table display |

### 4. calcFn + calcFnForMatrix (In-Memory Computation)

The engine supports two ways to process data in memory, both **bypassing SQL**.

---

#### 4.1 calcFn (Row-Level Computation)

Executes independently on **each record** of the flat array, suitable for derived calculations based on current metric values.

**flat Data Structure:**
```json
{
  "rowKeys": ["dim_value1", "dim_value2"],
  "colKey": "metric_alias",
  "alias": "metric_alias",
  "value": numeric
}
```

**calcFn Signature:** `(row) => result`

| Parameter | Description |
|---|---|
| `row.rowKeys[n]` | The nth dimension value (e.g., `row.rowKeys[0]` = tenant name) |
| `row.colKey` | Current metric alias (identifies which metric) |
| `row.value` | Current metric aggregated value |
| `Return value` | Any type, attached to `row[alias]` |

**Example: Tagging deal unit price**
```json
{
  "alias": "price_rating",
  "calcFn": "(row) => {
    if (row.colKey !== \"成交单价\") return null;
    return row.value > 140 ? \"高价\" : row.value > 110 ? \"中价\" : \"低价\";
  }"
}
```

**Example: Rating lease area**
```json
{
  "alias": "area_rating",
  "calcFn": "(row) => {
    if (row.colKey !== \"签约面积\") return null;
    return row.value > 400 ? \"大面积\" : row.value > 150 ? \"中面积\" : \"小面积\";
  }"
}
```

**Full Query:**
```json
{
  "dataSources": [{"table": "contract_units"}, {"table": "contracts"}, {"table": "tenants"}],
  "rowDims": [
    {"alias": "tenant", "field": "tenants.name"},
    {"alias": "unit", "field": "units.code"}
  ],
  "metrics": [
    {"field": "contract_units.deal_unit_price", "agg": "AVG", "alias": "unit_price"},
    {"field": "contract_units.lease_area", "agg": "SUM", "alias": "total_area"},
    {"field": "contract_units.deal_total_price", "agg": "SUM", "alias": "monthly_rent"},
    {"alias": "price_rating", "calcFn": "(row) => {
      if (row.colKey !== \"unit_price\") return null;
      return row.value > 140 ? \"high\" : row.value > 110 ? \"medium\" : \"low\";
    }"},
    {"alias": "area_rating", "calcFn": "(row) => {
      if (row.colKey !== \"total_area\") return null;
      return row.value > 400 ? \"large\" : row.value > 150 ? \"medium\" : \"small\";
    }"}
  ]
}
```

The response includes label fields, readable from both `rows` and `flat`.

**calcFn vs calcFnForMatrix:**

| | calcFn | calcFnForMatrix |
|---|---|---|
| Input | `(row)` — single flat entry | `(flat)` — entire flat array |
| Execution | Per-row | Single run |
| Access | `row.value`, `row.colKey`, `row.rowKeys[n]` | All flat entries |
| Best for | Threshold checks, tagging, classification | Group aggregation, cross-calculation, pivot |

---

#### 4.2 calcFnForMatrix (Full Computation)

Receives the entire flat array for cross-row processing, suitable for group aggregates, ratio calculations, and pivot tables.

> ⚠️ rowDims must use the alias format (`{"alias":"tenant","field":"tenants.name"}`), otherwise rowKeys will be all `__undefined__`.

#### Mode A: In-place modify flat ✅ Recommended

```json
{
  "alias": "ratio",
  "calcFnForMatrix": "(flat) => {
    const total = flat.reduce((s, i) => s + (i.value || 0), 0);
    flat.forEach(i => { i.rate = ((i.value||0)/total*100).toFixed(1) + '%'; });
    return flat;
  }"
}
```

**Group Summary Example:**
```json
{
  "alias": "summary",
  "calcFnForMatrix": "(flat) => {
    const groups = {};
    flat.forEach(i => {
      const key = i.rowKeys[0];
      if (!groups[key]) groups[key] = { rent:0, management:0, total:0 };
      if (i.colKey === 'rent') groups[key].rent += i.value;
      if (i.colKey === 'management') groups[key].management += i.value;
      if (i.colKey === 'total') groups[key].total += i.value;
    });
    let totalRent=0, totalMgmt=0, totalTotal=0;
    Object.values(groups).forEach(v => {
      totalRent += v.rent; totalMgmt += v.management; totalTotal += v.total;
    });
    flat.forEach(i => {
      const key = i.rowKeys[0];
      i.subtotal = JSON.stringify(groups[key]);
      i.grandTotal = 'Rent:' + totalRent + ' Mgmt:' + totalMgmt + ' Total:' + totalTotal;
    });
    return flat;
  }"
}
```

#### Mode B: Return object/array to matrix

```json
{
  "alias": "prediction",
  "calcFnForMatrix": "(flat) => {
    const r = {};
    flat.forEach(i => r[i.rowKeys[0]] = i.value || 0);
    return { 'vacant': r['vacant'] || 0, 'leased': r['leased'] || 0 };
  }"
}
```

**Mode Comparison:**

| Scenario | Recommended |
|---|---|
| Add ratios/tags/derived columns | **Mode A** ✅ |
| Group summary + totals | **Mode A** ✅ |
| Pivot tables / cross matrices | **Mode B** |
| Complex cross-row aggregation | Client-side processing |

---

#### 4.3 Risk Notes & Future Directions

`calcFn` and `calcFnForMatrix` use `new Function()` to instantiate JS code strings into executable functions, running directly in the server process memory. This is a **very aggressive design**.

**Why it was designed this way — irreplaceable advantages:**

| Advantage | Description |
|---|---|
| **Zero deployment cost** | Computation logic travels with the request as a JSON string — no server code changes, no deployments, no restarts. Report logic changes take effect instantly at the request level |
| **Client independence** | Whether the frontend is Web, mobile, or a third-party system, all consume processed data through the same DSL without reimplementing logic on each client |
| **Cross-row aggregation** | Computations that are hard to express in SQL (group ratios, YoY/ MoM, tree summaries) can be flexibly processed in memory on the full flat array |
| **Response-ready** | Results carry labels, ratings, group summaries and other derived fields — the client renders directly with no additional requests or local computation |

> The essence of this trade-off: **accepting server-side risk in exchange for extreme agility in business iteration.**

Risks to be aware of:

| Risk | Description |
|---|---|
| **Code injection** | JS strings in the request body execute via `new Function()` — malicious code can directly manipulate server memory and processes |
| **Runtime exceptions** | Uncaught JS exceptions can hang requests or crash the process |
| **Infinite loops** | `while(true)` or infinite loops in `calcFnForMatrix` will lock the event loop |
| **Memory leaks** | Closure references and global variable pollution accumulate across requests, gradually exhausting server memory |
| **Unpredictable performance** | Every request dynamically compiles and executes JS — overhead is non-trivial at high frequency |

> ⚠️ The current implementation (`new Function` + in-process execution) essentially **passes user code directly to the runtime** with zero security isolation.

> ⚠️ **Only recommended for trusted internal network environments.** Any scenario exposed to the public internet or untrusted callers should disable calcFn/calcFnForMatrix.

**Future optimization directions:**

| Direction | Description |
|---|---|
| **Move to client** | Return flat data to the client; let the frontend or caller handle computation. Server only handles SQL queries and data assembly |
| **Server-side sandbox** | If server-side execution is required, introduce an isolated sandbox (e.g., `vm2`, `isolated-vm`, WebAssembly sandbox) with CPU time limits, memory caps, and global scope restrictions |
| **Expression engine replacement** | Replace full JS with a restricted expression DSL (e.g., JSON Logic, simple math formulas) — trade flexibility for safety |

> 🔴 **Recommendation:** In untrusted environments, prioritize client-side in-memory computation. The server should only provide SQL query and data assembly capabilities.

---

### 5. Conditional Aggregation

Apply filter conditions within a metric to generate `COUNT(CASE WHEN ... THEN 1 END)`:

```json
{
  "field": "id", "agg": "COUNT",
  "alias": "leased_count",
  "condition": {"field": "status", "op": "=", "value": "leased"}
}
```

### 6. combinedDims (Combined Dimension Display)

Merge multiple rowDims fields into a single column. Two modes:

**Mode 1: String Concatenation (Default)**

```json
{
  "combinedDims": [
    {"alias": "area_range", "fields": ["min_area", "max_area"], "combineWith": "~"}
  ]
}
```
→ Output: `"100~200"`

**Mode 2: Operator Calculation**

Supports `+` `-` `*` `/` on numeric fields:

```json
{
  "dataSources": [{"table": "units"}],
  "rowDims": [
    {"field": "units.lease_area", "groupBy": true, "alias": "a"},
    {"field": "units.usable_area", "groupBy": true, "alias": "b"}
  ],
  "combinedDims": [
    {"alias": "area_diff", "fields": ["a", "b"], "mode": "operator", "operator": "-"}
  ],
  "limit": 100
}
```
→ Output: `a - b` computed per row, stored in `area_diff` column

**Field Reference:**

| Param | Type | Required | Description |
|---|---|---|---|
| `alias` | string | ✅ | Combined column name |
| `fields` | `[string]` | ✅ | list of rowDim aliases to combine |
| `combineWith` | string | ❌ | String concatenation separator (default `"~"`) |
| `mode` | string | ❌ | Set to `"operator"` to enable operator mode |
| `operator` | string | operator mode only | Supports `+` `-` `*` `/` |

---

## Quick Query Patterns

### Single Table
```json
{"dataSources": [{"table": "units"}], "rowDims": ["code", "status"], "limit": 10}
```

### Multi-Table Join
```json
{"dataSources": [{"table": "contracts"}, {"table": "tenants"}], "rowDims": ["contracts.contract_number", "tenants.name"]}
```

### Aggregation
```json
{
  "dataSources": [{"table": "units"}, {"table": "buildings"}],
  "rowDims": ["buildings.name"],
  "metrics": [
    {"field": "id", "agg": "COUNT", "alias": "unit_count"},
    {"field": "lease_area", "agg": "SUM", "alias": "total_area"}
  ]
}
```

### With Filters
```json
{
  "dataSources": [{"table": "bills"}, {"table": "contracts"}],
  "rowDims": ["bills.bill_number", "contracts.contract_number", "bills.total"],
  "filters": [
    {"field": "bills.status", "op": "=", "value": "unpaid"},
    {"field": "bills.total", "op": ">", "value": 10000}
  ],
  "orderBy": {"field": "bills.total", "direction": "DESC"}
}
```

### Multi-Dimension Pivot + Totals
```json
{
  "dataSources": [{"table": "units"}, {"table": "buildings"}],
  "rowDims": [{"alias": "building", "field": "buildings.name"}, {"alias": "status", "field": "units.status"}],
  "metrics": [
    {"field": "id", "agg": "COUNT", "alias": "count"},
    {"field": "lease_area", "agg": "SUM", "alias": "total_area"}
  ],
  "totalEnabled": true
}
```

---

## 🗂 Swapping Resource Graphs (Adapting to Different Business Scenarios)

The engine has two core pluggable components:

### 1. resourceDictionary

Defines all tables, field labels, and relationships for a business scenario. Located at `resources/resourceDictionary.js`.

**Record Structure:**

```javascript
const resourceDictionary = {
  TableName: {
    label: "Display Name",
    alias: "short_alias",           // SQL short alias, e.g. "c" for contracts
    description: "Description",
    defaultFields: ["field1", "field2"],  // Default fields for API /resources
    fields: {
      fieldName: {
        label: "Display Label",
        description: "Field description"
      }
    },
    relations: [
      {
        name: "relation_name",          // e.g. "tenant"
        type: "TargetTable",            // e.g. "tenants"
        relation_type: "belongs_to",    // Relationship type
        on: "source.fk = target.pk"     // JOIN condition
      }
    ]
  }
};
```

**Steps to replace:**

1. Define your table structures + field labels
2. Declare foreign key relationships for each table (`relations`)
3. Replace the exported object in `resources/resourceDictionary.js`
4. Restart the service

> No other code changes needed — ReportBuilder, routing, and matrix computation all auto-adapt.

---

### 1.1 Edge Configuration (ResourceGraph Core)

#### Core Principle: One-Way Only, No Bidirectional

**Each edge is declared once in one direction — never bidirectionally.** The engine internally generates reverse edges for routing, but bidirectional user configuration creates cycles that break Dijkstra's path inference.

> Rule: **Declare edges on the table that holds the foreign key, pointing to the target table.**

---

#### Edge Structure

```javascript
{
  name: "semantic_relation_name",  // e.g. "tenant"
  type: "target_table",            // e.g. "tenants"
  relation_type: "belongs_to",
  on: "source.fk = target.pk"
}
```

#### Field Reference

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Semantic relation name, e.g. `"tenant"`. Used for JOIN alias generation (`{target}_as_{relation}`). **Different names allow multiple JOINs to the same table.** |
| `type` | ✅ | Target table name, must match `resourceDictionary` key. |
| `relation_type` | ✅ | **`belongs_to`** (many-to-one, FK direction) / **`has_many`** (one-to-many, PK direction). Generally only configure `belongs_to`. |
| `on` | ✅ | JOIN condition. Format: `source.fk = target.pk`. The engine auto-replaces table names with aliases. |
| `weight` | ❌ | **Leave empty** — engine calculates automatically. If manual override needed, lower values take priority. |

#### Weight Auto-Calculation (Preset, Not Yet Active)

Weights are reserved for edge cases with **few nodes but still compound paths**. Most scenarios don't rely on weights since the two-layer graph design already narrows the path space significantly.

| Condition | Weight Bonus |
|---|---|
| Base weight | `1.0` |
| `relation_type = "many_to_many"` | `+0.5` (penalize detours) |
| `name` is `creator`/`updater`/`auditor` | `+5.0` (system tables, last resort) |
| Reverse edge (auto-generated) | `+0.1` (forward-first) |

> The `weight` field can be left empty; currently unused.

---

#### Two-Layer Graph Design (Key to Cycle Prevention)

The engine does not run Dijkstra on the full queryable graph directly. Instead, it uses two layers:

**Layer 1: resourceDictionary (Queryable Graph)**

`resourceDictionary` defines the **tables and relationships the engine can query** — the upper bound of query scope.

```javascript
const resourceDictionary = {
  contracts: { ..., relations: [...] },
  units: { ..., relations: [...] },
  tenants: { ..., relations: [...] },
  // ... etc
}
```

**Layer 2: dataSources (Subgraph — Instant Query Scope)**

The user specifies the tables relevant to this query in `dataSources`, and the engine **only routes within this subset**.

```json
// User queries contract units and buildings, not periods or bills
{
  "dataSources": [
    {"table": "contracts"},
    {"table": "buildings"}
  ],
  "rowDims": ["contracts.contract_number", "buildings.name"]
}
```

Engine processing flow:

```
1. Extract starting tables from dataSources: {contracts, buildings}
2. Check if a path exists between each pair of starting tables
3. In the resourceDictionary queryable graph, find the shortest path contracts → buildings
4. Path goes through contract_units + units, auto-added to dataSources
5. Final subgraph: {contracts, contract_units, units, buildings}
6. Only on this closure subgraph: lock paths, assign aliases, generate JOINs
```

**Why this prevents cycles:**

- Users configure only one-way edges — the graph is DAG-oriented
- `dataSources` limits the search scope — each query routes within a 3~6 table closure
- The engine never loads the full queryable graph into one query, avoiding cross-domain ambiguous paths
- Internal reverse edges are only used for Dijkstra "backtracking," never producing real SQL cycles

---

#### Dijkstra Pathfinding (Within Subgraph)

```
Request: dataSources = [contracts, buildings]

1. Engine fetches edges for contracts and buildings from resourceDictionary
2. No direct edge found, starts Dijkstra within the subgraph:
   contracts ──(1.0)──→ contract_units
   contract_units ──(1.0)──→ units
   units ──(1.0)──→ buildings
   
3. Optimal path found (total weight 3.0), expands dataSources:
   [contracts, contract_units, units, buildings]

4. Lock alias chain:
   contracts → cu_as_contract_units → u_as_unit → b

5. Generate INNER JOIN:
   cu ON cu.contract_id = c.id
   u  ON u.id = cu.unit_id
   b  ON b.id = u.building_id
```

---

#### Configuration Method

**Declare `belongs_to` on foreign key tables:**

```javascript
// contracts: belongs to tenants
contracts: {
  relations: [
    { name: "tenant", type: "tenants", relation_type: "belongs_to", on: "contracts.tenant_id = tenants.id" }
  ]
}

// contract_units: belongs to contracts and units
contract_units: {
  relations: [
    { name: "contract", type: "contracts", relation_type: "belongs_to", on: "contract_units.contract_id = contracts.id" },
    { name: "unit",     type: "units",     relation_type: "belongs_to", on: "contract_units.unit_id = units.id" }
  ]
}

// Primary key tables (tenants, units, etc.): only configure has_many pointing to themselves
units: {
  relations: [
    { name: "contract_units", type: "contract_units", relation_type: "has_many", on: "contract_units.unit_id = units.id" },
    { name: "building",      type: "buildings",      relation_type: "belongs_to", on: "units.building_id = buildings.id" }
  ]
}
```

> Declare `belongs_to` on the foreign key table and `has_many` on the primary key table. Don't configure both sides of the same relationship.

#### Configuration Rules

| Rule | Description |
|---|---|
| ✅ **One direction only** | FK table: `belongs_to`, PK table: `has_many`. Pick one, never both |
| ✅ **Semantic relation names** | Use `"tenant"` instead of `"rel1"` — readable at debug time |
| ✅ **Accurate relation_type** | `belongs_to` or `has_many`, don't mix them up |
| ✅ **Bridge tables fully declared** | Many-to-many must go through an intermediary in two hops |
| ✅ **Use raw table names in `on`** | The engine auto-replaces with aliases |
| ❌ **Don't declare both ends** | Causes cycles |
| ❌ **Don't use `many_to_many` directly** | Must bridge through an intermediary table |

#### Debugging Paths

The engine includes Mermaid visualization for verifying paths:

```javascript
// In code
const mermaid = resourceGraph.getDebugMermaid('contracts', 'buildings');
console.log(mermaid);
// Output:
// graph LR
//     contracts -- "contract_units (w:1.0)" --> contract_units
//     contract_units -- "unit (w:1.0)" --> units
//     units -- "building (w:1.0)" --> buildings
```

---

### 2. valuesMapping (Enum Mapping)

Defines translation rules from internal English codes to display text. Located at `mapper/values_mapping.js`.

```javascript
const myEnumMappings = {
  'table.field': {
    'code1': 'Display1',
    'code2': 'Display2',
    // ...
  }
};
```

**Steps to replace:**

1. Register your enum mappings by `{table}.{field}`
2. Merge via destructuring in `allEnumMappings`
3. Ensure `rowDims` fields go through `applyEnumMappings`

> If enum translation is not needed, set `allEnumMappings` to `{}`.

---

### 3. dataLoader (Data Loading)

Defines where data comes from and how it's loaded into DuckDB. Located at `services/dataLoader.js`.

```javascript
async function loadAllDataSources(con) {
  // Pull data from MySQL / CSV / API, etc.
  // Create DuckDB tables: con.exec("CREATE TABLE xxx AS SELECT * FROM read_csv('...')")
}
```

**Supported data source methods:**

| Method | Use Case |
|---|---|
| `read_csv` | Static data files |
| `read_parquet` | Columnar big data |
| `ATTACH '...' AS mysql` | Direct MySQL real-time query |
| INSERT row-by-row | API callback writes |

---

### Typical Adaptation Workflow

Example: switching from "office leasing" to "e-commerce orders":

```
1. Write resourceDictionary → orders, products, users table definitions + relations
2. Write valuesMapping  → e.g. orders.status: 'pending'→'Pending', 'shipped'→'Shipped'
3. Write dataLoader    → Pull from e-commerce DB to DuckDB
4. Restart service     → routes/report.js zero changes
5. Send DSL request    → Auto JOIN orders → order_items → products
```

**Core principle: engine code never changes, only configuration.**

---

## Notes

| Issue | Solution |
|---|---|
| Filter value must use English codes | Stored as English internally, auto-translated on response |
| rowDims should use alias format | Otherwise rowKeys in flat may be empty |
| Access flat via `rowKeys[n]` + `colKey` + `value` | Do not access fields by name directly |
| IN value must be an array | `["a", "b"]` not `"a,b"` or `"a"` |
| Table count depends on graph quality | Virtually unlimited if edges connect, no cycles, no Cartesian risk |
| calcFn with non-ASCII chars | Write request body to file `-d @query.json` to avoid shell encoding issues |

---

## License

This project is open source under the **MIT License**. See the [LICENSE](./LICENSE) file for details.
