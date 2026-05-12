# LexiPathOS

## 概述

LexiPathOS 是一个基于 **DuckDB** 的语义查询引擎，通过一套统一的 JSON DSL，以自然语义的方式查询任意结构化数据，无需手写 SQL 或理解底层表关系。

**核心能力：**
- 自动推演多表 JOIN 路径（Dijkstra 加权最优路径）
- 枚举值自动翻译（英文码 → 中文显示）
- 内存二次计算（flat 加工、矩阵透视）
- 统一响应格式（rows + flat + matrix）

> 本仓库的代码以**写字楼租赁行业**的业务数据作为落地案例，展示引擎的实际使用场景。代码中涉及的表（contracts、units、tenants、bills 等）均为该行业的业务数据结构，**并非引擎本身的标准**——切换行业只需替换数据字典和业务配置，引擎代码无需改动。

---

## 架构

```
┌─────────────────────────────────────────────────┐
│                  客户端 (Client)                  │
│         发送 DSL JSON → 接收 rows/flat/matrix     │
└──────────────────┬──────────────────────────────┘
                   │ POST /api/report/execute
                   ▼
┌─────────────────────────────────────────────────┐
│               Routes / Middleware                │
│        参数校验 → 调用 → 响应序列化              │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│              ReportBuilder (核心引擎)             │
│                                                 │
│  1. loadFromJson(json)  ← 解析 DSL              │
│  2. autoGenerateJoins()  ← ResourceGraph 自动寻路│
│  3. buildSQL()  ← 生成 SQL                      │
│  4. execute()  ← DuckDB 执行 + 汇总行            │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│           ResourceGraph (关系图谱)                │
│                                                 │
│  - 多表外键关系定义                              │
│  - Dijkstra 加权最优路径搜索                     │
│  - 自动补全中间表 + 分配别名                     │
│  - 支持 Mermaid 导出可视化                       │
└──────────────────┬──────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│         Mapper + MatrixUtil (后处理)              │
│                                                 │
│  - applyEnumMappings: 英文码→中文显示            │
│  - ReportMatrixUtil: SQL rows → flat + matrix    │
│  - calcFnForMatrix: 内存 JS 二次加工              │
│  - combinedDims: 多字段合并显示                   │
└─────────────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────┐
│              响应格式 (Response)                  │
│                                                 │
│  {                                              │
│    success: true,                               │
│    rows: [...],      ← 原始 SQL 结果            │
│    matrix: {...},    ← 透视矩阵                  │
│    flat: [...],      ← 展开后的扁平数据          │
│    total: N,         ← 行数                      │
│    sql: "...",       ← 生成的 SQL (调试用)       │
│    combinedInfo: []  ← 合并字段信息              │
│  }                                              │
└─────────────────────────────────────────────────┘
```

---

## 运行机理

### 部署时：ER 图编排 → 可查图

在部署阶段，根据业务场景的 ER 图（实体关系图），**按需选取相关表和关系边**，编排到 `resourceDictionary` 中，形成引擎的**可查图**。

```
ER 图（业务建模）
    │
    ▼ 按需选取
resourceDictionary（可查图）
    ├── 表定义（表名、字段标签、别名）
    └── 边定义（relations：表与表之间的外键关联）
```

这个可查图定义了引擎**能查什么**，是查询范围的上限。引擎不会超出这个范围去寻路。

> `resourceDictionary` 是引擎唯一需要根据业务定制的部分。切换行业时，只需要根据新业务的 ER 图按需编排这个字典，引擎代码零改动。

---

### 运行时：剪裁 → 子图 → 寻路

每次收到查询请求，引擎不会把可查图加载到查询中，而是按以下流程执行：

```
请求（dataSources: [contracts, buildings]）
    │
    ▼ 第 1 步：提取起点
从 dataSources 中提取本次查询涉及的起始表
    │
    ▼ 第 2 步：剪裁（Pruning）
在可查图（resourceDictionary）中，
仅保留与起始表相关的关系边，剪掉无关分支
    │
    ▼ 第 3 步：补全中间表
在剪裁后的子图上运行 Dijkstra，
自动补全路径所需的中间表
    │
    ▼ 第 4 步：生成 Runtime 子图
锁定闭包子图 → 分配表别名 → 生成 JOIN 链条
    │
    ▼ 第 5 步：执行
组装 SQL → DuckDB 执行 → 后处理（枚举翻译、矩阵透视）
    │
    ▼ 返回结果
```

关键点：

- **可查图**由 `resourceDictionary` 在部署时定义，是静态的
- **Runtime 子图**由每次请求的 `dataSources` 决定，是动态剪裁的结果
- **中间表自动补全**——如查 contracts 与 buildings，引擎会自动找到 contract_units → units 作为桥梁
- **剪裁防环路**——子图只包含 3~6 张表的闭包，不会将全量图拖入一次查询

```
┌─────────────────────────────────────────────┐
│  部署时（静态）                               │
│                                             │
│  ER 图 ──→ resourceDictionary（可查图）       │
│             所有表与关系边                    │
└──────────────────┬──────────────────────────┘
                   │ 运行时剪裁
                   ▼
┌─────────────────────────────────────────────┐
│  运行时（动态）                               │
│                                             │
│  dataSources ──→ 子图（闭包）──→ Dijkstra ──→ JOIN│
│  每次请求独立                                │
└─────────────────────────────────────────────┘
```

---

## 数据来源

引擎启动时，通过 `dataLoader` 从 MySQL 实时读取业务数据加载到 DuckDB 内存库中。每次启动会全量拉取所有数据源，也可通过增量接口按需同步。

```
请求启动
    │
    ▼
dataLoader 连接 MySQL（通过环境变量配置）
    │
    ├── 读取 dataSource 配置（定义每张表的映射）
    ├── 循环拉取每张表
    │   ├── 读取 MySQL 表结构（字段名 + 类型）
    │   ├── 类型自动映射（INT→BIGINT, DECIMAL→DOUBLE, DATE→TIMESTAMP 等）
    │   ├── DROP + CREATE 重建 DuckDB 表
    │   └── 分批 INSERT（每批 1000 条）
    │
    ▼
DuckDB 内存库就绪，等待 DSL 查询
```

### MySQL 连接配置

| 环境变量 | 说明 |
|---|---|
| `MYSQL_HOST` | MySQL 服务器地址 |
| `MYSQL_USER` | 数据库用户名 |
| `MYSQL_PASSWORD` | 数据库密码 |
| `MYSQL_DATABASE` | 数据库名 |

### 增量同步

`POST /api/incremental` 可对指定数据源增量拉取更新，接收 `{ dataSource, lastUpdated }`，只拉取变更时间之后的数据。

> 因为 DuckDB 使用 `:memory:` 模式，**重启后数据即丢失**，启动时会自动从 MySQL 全量重载。

---

## DSL 参考

### 完整结构

```json
{
  "dataSources": [
    {"table": "表名1"},
    {"table": "表名2"}
  ],
  "rowDims": [
    "表.字段",
    {"alias": "别名", "field": "表.字段"},
    {"alias": "别名", "field": "表.字段", "groupBy": false}
  ],
  "metrics": [
    {"field": "表.字段", "agg": "SUM|COUNT|AVG|MAX|MIN", "alias": "别名"},
    {"field": "表.字段", "agg": "COUNT", "alias": "条件计数", "condition": {"field": "表.字段", "op": "=", "value": "值"}},
    {"alias": "别名", "calcFnForMatrix": "(flat) => { /* JS */ }"}
  ],
  "filters": [
    {"field": "表.字段", "op": "=", "value": "值"},
    {"field": "表.字段", "op": "IN", "value": ["值1", "值2"]},
    {"field": "表.字段", "op": "BETWEEN", "value": ["开始", "结束"]},
    {"field": "表.字段", "op": "LIKE", "value": "模式"},
    {"field": "表.字段", "op": "IS", "value": null}
  ],
  "orderBy": {"field": "表.字段", "direction": "ASC|DESC"},
  "orderBy": [{"field": "字段1", "direction": "ASC"}, {"field": "字段2", "direction": "DESC"}],
  "combinedDims": [
    {"alias": "合并列名", "fields": ["别名1", "别名2"], "combineWith": "分隔符"}
  ],
  "totalEnabled": true,
  "limit": 100
}
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `dataSources` | `[{table}]` | ✅ | 数据源表列表，只需起点表，API 自动补中间表 |
| `rowDims` | `[string\|object]` | ❌ | 行维度。string=`"表.字段"`，object=`{alias, field, groupBy?}` |
| `metrics` | `[object]` | ❌ | 聚合指标。`{field, agg, alias}` 或 `{alias, calcFnForMatrix}` |
| `filters` | `[object]` | ❌ | 过滤条件。`{field, op, value}` |
| `orderBy` | `object\|array` | ❌ | 排序：单字段对象或多字段数组 |
| `combinedDims` | `[object]` | ❌ | 合并维度显示 |
| `totalEnabled` | `boolean` | ❌ | 是否追加汇总行 |
| `limit` | `number` | ❌ | 返回条数上限，默认 100 |

### 操作符

| 操作符 | 用法 |
|---|---|
| `=` | 等于 |
| `!=` | 不等于 |
| `>` / `<` | 大于/小于 |
| `>=` / `<=` | 大于等于/小于等于 |
| `LIKE` | 模糊匹配 |
| `LIKE` | 模糊匹配（支持 `%` 通配符） |
| `BETWEEN` | 范围匹配，value 传 `[开始, 结束]` |
| `IN` | 列表匹配，value 传**数组** `["a", "b"]` |
| `IS` | 空值匹配，value 传 `null` |

---

## 核心机制

### 1. 自动 JOIN 推演

**不需要手写关系！** 只需要在 `dataSources` 里放入你关心的表，引擎会：

1. 从 **ResourceGraph** 查找表之间的最短加权路径
2. 自动补全中间表（如 contracts → contract_units → units → buildings）
3. 分配不冲突的表别名
4. 生成完整的 JOIN 链条

路径权重设计（**预设，暂不发挥作用**，为预防节点少但仍有复合路径的极端场景保留）：
- **belongs_to / has_many** 主路径：权重 1.0
- **多对多**中间表：权重 +0.5
- **系统辅助表**（creator/updater）：权重 +5.0
- **反向路径**：权重 +0.1 惩罚

**表数量上限：取决于关系图质量，引擎不设硬性限制**

能 JOIN 多少张表取决于图配得好不好，而不是引擎本身的能力上限。三个关键约束：

| 约束 | 说明 |
|---|---|
| **边不断** | 查询涉及的表之间必须有路径可达。缺中间表引擎会自动补全，但起点和终点之间如果根本不通就会报错 |
| **不成环** | 单向配边、禁止双向声明同一条关系。环路会导致 Dijkstra 死循环或路径歧义 |
| **无笛卡尔积风险** | `one_to_many` 链路过长→中间表行数膨胀→结果集爆炸（1条合同×10条账期×5条账单=50行）。`many_to_many` 直接关联更是高危操作，必须通过桥接表分两步走 |

除此之外，表数量几乎只受限于 DuckDB 的性能——多张表理论上都能走通，只要图配得干净。

### 2. 枚举自动翻译

底层存英文码，返回自动转中文，filter 时用英文码。

例如 `units.status` 存的是 `"vacant"`：
- filter 时写 `"value": "vacant"`
- 返回显示 `"空置"`

完整映射定义在 `values_mapping.js` 中，按 `{表名}.{字段名}` 注册。

### 3. 双模式输出

| 格式 | 来源 | 用途 |
|---|---|---|
| `rows` | SQL 直接结果 | 原始数据展示 |
| `flat` | rows 摊平后的数组 | calcFnForMatrix 的输入/输出 |
| `matrix` | flat 构建的嵌套对象 | 透视表展示 |

### 4. calcFn + calcFnForMatrix（内存计算）

引擎支持两种在内存中加工数据的方式，均**不走 SQL**。

---

#### 4.1 calcFn（行级计算 — 逐条加工）

对 flat 数组的**每条记录独立执行**，适合根据当前指标值做衍生计算。

**flat 数据结构回顾：**
```json
{
  "rowKeys": ["维度值1", "维度值2"],
  "colKey": "指标别名",
  "alias": "指标别名",
  "value": 数值
}
```

**calcFn 的函数签名：** `(row) => result`

| 参数 | 说明 |
|---|---|
| `row.rowKeys[n]` | 第 n 个维度的值（如 `row.rowKeys[0]` = 租户名） |
| `row.colKey` | 当前指标别名（用于区分这是哪个指标） |
| `row.value` | 当前指标聚合值 |
| `返回值` | 任意类型，挂到 `row[alias]` 上 |

**示例：对成交单价打标签**
```json
{
  "alias": "单价评级",
  "calcFn": "(row) => {
    if (row.colKey !== \"成交单价\") return null;
    return row.value > 140 ? \"高价\" : row.value > 110 ? \"中价\" : \"低价\";
  }"
}
```

**示例：对签约面积评分**
```json
{
  "alias": "面积评分",
  "calcFn": "(row) => {
    if (row.colKey !== \"签约面积\") return null;
    return row.value > 400 ? \"大面积\" : row.value > 150 ? \"中面积\" : \"小面积\";
  }"
}
```

**完整查询：**
```json
{
  "dataSources": [{"table": "contract_units"}, {"table": "contracts"}, {"table": "tenants"}],
  "rowDims": [
    {"alias": "租户", "field": "tenants.name"},
    {"alias": "单元", "field": "units.code"}
  ],
  "metrics": [
    {"field": "contract_units.deal_unit_price", "agg": "AVG", "alias": "成交单价"},
    {"field": "contract_units.lease_area", "agg": "SUM", "alias": "签约面积"},
    {"field": "contract_units.deal_total_price", "agg": "SUM", "alias": "月租金"},
    {"alias": "单价评级", "calcFn": "(row) => {
      if (row.colKey !== \"成交单价\") return null;
      return row.value > 140 ? \"高价\" : row.value > 110 ? \"中价\" : \"低价\";
    }"},
    {"alias": "面积评分", "calcFn": "(row) => {
      if (row.colKey !== \"签约面积\") return null;
      return row.value > 400 ? \"大面积\" : row.value > 150 ? \"中面积\" : \"小面积\";
    }"}
  ]
}
```

返回结果会携带标签字段，`rows` 和 `flat` 中均可读取。

**calcFn vs calcFnForMatrix：**

| | calcFn | calcFnForMatrix |
|---|---|---|
| 输入 | `(row)`— 单条 flat | `(flat)`— 整个 flat 数组 |
| 执行 | 逐条运行 | 一次运行 |
| 能访问 | `row.value`, `row.colKey`, `row.rowKeys[n]` | 所有 flat 条目 |
| 适合场景 | 阈值判断、打标签、分类 | 分组汇总、交叉计算、矩阵透视 |

---

#### 4.2 calcFnForMatrix（全量计算）

接收整个 flat 数组做跨行加工，适合分组汇总、占比计算、矩阵透视。

> ⚠️ rowDims 必须用 alias 格式（`{"alias":"租户","field":"tenants.name"}`），否则 rowKeys 全是 `__undefined__`。

#### 模式 A：in-place 修改 flat ✅ 推荐

```json
{
  "alias": "占比",
  "calcFnForMatrix": "(flat) => {
    const total = flat.reduce((s, i) => s + (i.value || 0), 0);
    flat.forEach(i => { i.rate = ((i.value||0)/total*100).toFixed(1) + '%'; });
    return flat;
  }"
}
```

**分组汇总示例：**
```json
{
  "alias": "汇总",
  "calcFnForMatrix": "(flat) => {
    // 第一步：按维度分组汇总
    const groups = {};
    flat.forEach(i => {
      const key = i.rowKeys[0];
      if (!groups[key]) groups[key] = { 租金:0, 管理费:0, 应收:0 };
      if (i.colKey === '租金') groups[key].租金 += i.value;
      if (i.colKey === '管理费') groups[key].管理费 += i.value;
      if (i.colKey === '总额') groups[key].应收 += i.value;
    });
    // 第二步：计算总计
    let 总租金=0, 总管理费=0, 总应收=0;
    Object.values(groups).forEach(v => {
      总租金 += v.租金; 总管理费 += v.管理费; 总应收 += v.应收;
    });
    // 第三步：挂回 flat
    flat.forEach(i => {
      const key = i.rowKeys[0];
      i.小计 = JSON.stringify(groups[key]);
      i.总计 = '总租金' + 总租金 + '总管理费' + 总管理费 + '总应收' + 总应收;
    });
    return flat;
  }"
}
```

#### 模式 B：矩阵返回（返回 object/array 到 matrix）

```json
{
  "alias": "预测",
  "calcFnForMatrix": "(flat) => {
    const r = {};
    flat.forEach(i => r[i.rowKeys[0]] = i.value || 0);
    return { '可租': r['vacant'] || 0, '已租': r['leased'] || 0 };
  }"
}
```

**模式对比：**

| 场景 | 推荐 |
|---|---|
| 加占比/标签/衍生列 | **Mode A** ✅ |
| 分组汇总+总计行 | **Mode A** ✅ |
| 透视表/交叉矩阵 | **Mode B** |
| 复杂跨行聚合 | 客户端处理 |

---

#### 4.3 风险说明与优化方向

`calcFn` 和 `calcFnForMatrix` 使用 `new Function()` 将 JS 代码字符串实例化为可执行函数，直接在服务端进程内存中运行。这是一个**非常激进的设计**。

**之所以这么设计，是因为它带来了不可替代的优势：**

| 优势 | 说明 |
|---|---|
| **零部署成本** | 计算逻辑以 JSON 字符串形式随请求发送，无需修改服务端代码、无需部署、无需重启。报表逻辑变更在请求级别即时生效 |
| **客户端无关性** | 无论前端是 Web、移动端还是第三方系统，都能通过同一套 DSL 获得加工后的数据，无需在每个客户端重复实现计算逻辑 |
| **跨行聚合能力** | SQL 难以表达的计算（分组占比、同比环比、树形汇总）可以在内存中以全量 flat 数组灵活处理 |
| **响应即展示** | 结果中直接携带标签、评级、分组汇总等衍生字段，客户端拿到即可渲染，无需二次请求或本地计算 |

> 这个设计取舍的本质是：**用服务端的一定风险，换取业务迭代的极致敏捷。**

需要清楚的具体风险：

| 风险 | 说明 |
|---|---|
| **代码注入** | 请求体中的 JS 字符串通过 `new Function()` 执行，恶意代码可直接操控服务端内存和进程 |
| **运行时异常** | 未捕获的 JS 异常可能导致请求挂起或进程崩溃 |
| **无限循环** | `calcFnForMatrix` 中如果出现 `while(true)` 或死循环，会直接锁死事件循环 |
| **内存泄漏** | 闭包引用、全局变量污染可能随请求积累，逐步耗尽服务端内存 |
| **性能不可控** | 每次请求都动态编译和执行 JS，高频场景下开销不容忽视 |

> ⚠️ 当前实现（`new Function` + 进程内执行）本质上是在服务端**直通用户代码到运行时**，没有任何安全隔离。

> ⚠️ **仅建议在受信任的内部网络环境中使用此功能**。任何暴露到公网或给不可信调用方使用的场景，都应禁用 calcFn/calcFnForMatrix。

**未来优化方向：**

| 方向 | 说明 |
|---|---|
| **下沉到客户端** | 将 flat 数据返回给客户端，由前端或调用方自行加工计算。服务端只负责 SQL 查询和数据组装，消费方按需做二次处理 |
| **服务端沙盒** | 如果必须服务端执行，引入隔离沙盒（如 `vm2`、`isolated-vm`、WebAssembly 沙箱），限制 CPU 时间、内存上限、禁止访问全局作用域 |
| **表达式引擎替代** | 用受限的表达式 DSL（如 JSON Logic、简单数学公式）替代完整 JS，牺牲灵活性换取安全性 |

> 🔴 **建议：** 在非信任环境中，优先将内存计算逻辑放在客户端实现。服务端仅提供 SQL 查询和数据组装能力。

---

### 5. 条件聚合

对指标加条件过滤，生成 `COUNT(CASE WHEN ... THEN 1 END)`：

```json
{
  "field": "id", "agg": "COUNT",
  "alias": "已出租数",
  "condition": {"field": "status", "op": "=", "value": "leased"}
}
```

### 6. combinedDims（合并维度显示）

把多个 rowDims 字段合并成一列显示。支持两种模式：

**模式 1：字符串拼接（默认）**

```json
{
  "combinedDims": [
    {"alias": "面积区间", "fields": ["最小面积", "最大面积"], "combineWith": "~"}
  ]
}
```
→ 输出：`"100~200"`

**模式 2：运算符计算**

支持 `+` `-` `*` `/` 对数字字段做运算：

```json
{
  "dataSources": [{"table": "units"}],
  "rowDims": [
    {"field": "units.lease_area", "groupBy": true, "alias": "a"},
    {"field": "units.usable_area", "groupBy": true, "alias": "b"}
  ],
  "combinedDims": [
    {"alias": "面积差", "fields": ["a", "b"], "mode": "operator", "operator": "-"}
  ],
  "limit": 100
}
```
→ 输出：对每行计算 `a - b`，结果存入 `面积差` 列

**字段说明：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `alias` | string | ✅ | 合并后的列名 |
| `fields` | `[string]` | ✅ | 参与合并的 rowDim alias 列表 |
| `combineWith` | string | ❌ | 字符串拼接模式：分隔符（默认 `"~"`） |
| `mode` | string | ❌ | 设为 `"operator"` 启用运算符模式 |
| `operator` | string | 仅 operator 模式 | 支持 `+` `-` `*` `/` |

---

## 查询模式速查

### 单表查询
```json
{"dataSources": [{"table": "units"}], "rowDims": ["code", "status"], "limit": 10}
```

### 多表联查
```json
{"dataSources": [{"table": "contracts"}, {"table": "tenants"}], "rowDims": ["contracts.contract_number", "tenants.name"]}
```

### 聚合统计
```json
{
  "dataSources": [{"table": "units"}, {"table": "buildings"}],
  "rowDims": ["buildings.name"],
  "metrics": [
    {"field": "id", "agg": "COUNT", "alias": "单元数"},
    {"field": "lease_area", "agg": "SUM", "alias": "总面积"}
  ]
}
```

### 带条件过滤
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

### 多维度透视 + 汇总行
```json
{
  "dataSources": [{"table": "units"}, {"table": "buildings"}],
  "rowDims": [{"alias": "项目", "field": "buildings.name"}, {"alias": "状态", "field": "units.status"}],
  "metrics": [
    {"field": "id", "agg": "COUNT", "alias": "数量"},
    {"field": "lease_area", "agg": "SUM", "alias": "面积合计"}
  ],
  "totalEnabled": true
}
```

---

## 🗂 更换资源关系图（适配不同业务场景）

引擎的核心可插拔组件是两样：

### 1. resourceDictionary（数据字典）

定义业务场景下的所有表、字段标签、关联关系。位于 `resources/resourceDictionary.js`。

**每条记录的结构：**

```javascript
const resourceDictionary = {
  表名: {
    label: "中文表名",
    alias: "简短别名",           // SQL 中用的短别名，如 "c" 代表 contracts
    description: "说明",
    defaultFields: ["字段1", "字段2"],  // API /resources 返回的默认字段列表
    fields: {
      字段名: {
        label: "中文标签",
        description: "字段说明"
      }
    },
    relations: [
      {
        name: "关系名",                // 如 "tenant"
        type: "目标表名",               // 如 "tenants"
        relation_type: "belongs_to",    // 关系类型
        on: "源表.外键 = 目标表.主键"    // JOIN 条件
      }
    ]
  }
};
```

**替换步骤：**

1. 定义你的表结构 + 字段标签
2. 声明每张表与其他表的外键关系（`relations`）
3. 替换 `resources/resourceDictionary.js` 中的导出对象
4. 重启服务即可

> 不需要动任何其他代码——ReportBuilder、路由、矩阵计算全部自动适配。

---

### 1.1 图的边配置详解（ResourceGraph 核心）

#### 核心原则：只配单向，禁止双向

**每条边只在一个方向声明一次，绝不双向配置。** 引擎内部会自动生成反向边用于寻路，但用户配双向会产生环路，破坏 Dijkstra 的路径推演。

> 配置方向规则：**在外键所在的表上声明边，指向目标表。**

---

#### 边的结构

```javascript
{
  name: "关系语义名",      // 如 "tenant"
  type: "目标表名",         // 如 "tenants"
  relation_type: "belongs_to",
  on: "源表.外键 = 目标表.主键"
}
```

#### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 语义关系名，如 `"tenant"`。用于生成 Join 别名（`{目标表}_as_{关系名}`），**不同关系名允许多次 Join 同一张表**。 |
| `type` | ✅ | 目标表名，必须与 `resourceDictionary` 中的键名一致。 |
| `relation_type` | ✅ | **`belongs_to`**（多对一，外键方向）/ **`has_many`**（一对多，主键方向）。一般只配 `belongs_to`。 |
| `on` | ✅ | JOIN 条件。格式：`源表.外键 = 目标表.主键`。外层函数会自动替换表名为别名。 |
| `weight` | ❌ | **建议不填**，引擎自动计算。如需手动调整，值越小越优先。 |

#### 权重自动计算规则（预设，暂不发挥作用）

权重为预防**节点少但仍有复合路径**的极端场景保留。绝大多数场景下不依赖权重，因为两层图范围（resourceDictionary + dataSources）已经把路径空间限制得很窄了。

| 条件 | 权重加成 |
|---|---|
| 基础权重 | `1.0` |
| `relation_type = "many_to_many"` | `+0.5`（降权绕路路径） |
| `name` 为 `creator`/`updater`/`auditor` | `+5.0`（系统表，除非别无选择不走） |
| 反向边（引擎内部自动生成） | `+0.1`（顺向优先） |

> `weight` 字段可留空，当前版本不使用。

---

#### 两层图范围设计（防环路关键）

引擎不直接对可查图跑 Dijkstra，而是分两层：

**第 1 层：resourceDictionary（可查图）**

`resourceDictionary` 定义了引擎**可以查询的表和关系**——这是查询范围的上限。

```javascript
const resourceDictionary = {
  contracts: { ..., relations: [...] },
  units: { ..., relations: [...] },
  tenants: { ..., relations: [...] },
  // ... 等等
}
```

**第 2 层：dataSources（子图——即时查询范围）**

用户在 `dataSources` 中指定本次查询关心的表，引擎**只在这个子集内寻路**。

```json
// 用户只查合同的单元和项目，不查账期和账单
{
  "dataSources": [
    {"table": "contracts"},
    {"table": "buildings"}
  ],
  "rowDims": ["contracts.contract_number", "buildings.name"]
}
```

引擎的处理流程：

```
1. 从 dataSources 提取起始表集合: {contracts, buildings}
2. 检查每对起始表之间是否有路径
3. 在 resourceDictionary 的可查图中，查出 contracts → buildings 的最短路径
4. 路径经过中间表 contract_units + units，自动补入 dataSources
5. 最终子图: {contracts, contract_units, units, buildings}
6. 只在这个闭包子图上做路径锁定 + 别名分配 + JOIN 生成
```

**为什么这样能防环路：**

- 用户只配单向边，图结构是指向性明确的 DAG 倾向结构
- `dataSources` 限制了搜索范围，每次查询只在 3~6 张表的闭包内寻路
- 引擎不会把可查图加载到一次查询中，避免了跨业务的歧义路径
- 内部的反向边只用于 Dijkstra 的「回退搜索」，不会产生真正的 SQL 环路

---

#### Dijkstra 寻路过程（子图内）

```
请求: dataSources = [contracts, buildings]

1. 引擎从 resourceDictionary 取出 contracts 和 buildings 的边
2. 发现无直接边，在子图内启动 Dijkstra:
   contracts ──(1.0)──→ contract_units
   contract_units ──(1.0)──→ units
   units ──(1.0)──→ buildings
   
3. 找到最优路径（总权重 3.0），补全 dataSources:
   [contracts, contract_units, units, buildings]

4. 锁定别名链:
   contracts → cu_as_contract_units → u_as_unit → b

5. 生成 INNER JOIN:
   cu ON cu.contract_id = c.id
   u  ON u.id = cu.unit_id
   b  ON b.id = u.building_id
```

---

#### 配置方法

**在外键表上声明 `belongs_to`：**

```javascript
// contracts 表：声明它属于 tenants
contracts: {
  relations: [
    { name: "tenant", type: "tenants", relation_type: "belongs_to", on: "contracts.tenant_id = tenants.id" }
  ]
}

// contract_units 表：声明它属于 contracts 和 units
contract_units: {
  relations: [
    { name: "contract", type: "contracts", relation_type: "belongs_to", on: "contract_units.contract_id = contracts.id" },
    { name: "unit",     type: "units",     relation_type: "belongs_to", on: "contract_units.unit_id = units.id" }
  ]
}

// 主键表（tenants, units 等）：只配 has_many 指向自己，不反指外键表
units: {
  relations: [
    { name: "contract_units", type: "contract_units", relation_type: "has_many", on: "contract_units.unit_id = units.id" },
    { name: "building",      type: "buildings",      relation_type: "belongs_to", on: "units.building_id = buildings.id" }
  ]
}
```

> `belongs_to` 声明在外键表上，`has_many` 声明在主键表上。不要两张表都配同一条关系。

#### 配置守则

| 准则 | 说明 |
|---|---|
| ✅ **只配一个方向** | 外键表配 `belongs_to`，主键表配 `has_many`，二选一，不要同时配 |
| ✅ **关系名要有语义** | 用 `"tenant"` 而不是 `"rel1"`，别名调试时一眼看懂 |
| ✅ **relation_type 标注准确** | `belongs_to` 或 `has_many`，不要混用 |
| ✅ **桥接表要完整声明** | 多对多必须通过中间表两步跳转 |
| ✅ **`on` 条件中的表名用原始表名** | 引擎会自动替换为别名 |
| ❌ **不要在两端都声明同一条关系** | 会产生环路 |
| ❌ **不要配 `many_to_many` 直接连 A→B** | 必须通过中间表桥接 |

#### 调试路径

引擎内置 Mermaid 可视化，可用于验证路径是否正确：

```javascript
// 在代码中调用
const mermaid = resourceGraph.getDebugMermaid('contracts', 'buildings');
console.log(mermaid);
// 输出:
// graph LR
//     contracts -- "contract_units (w:1.0)" --> contract_units
//     contract_units -- "unit (w:1.0)" --> units
//     units -- "building (w:1.0)" --> buildings
```

---

### 2. valuesMapping（枚举映射）

定义底层英文码 → 显示用中文的翻译规则。位于 `mapper/values_mapping.js`。

```javascript
const myEnumMappings = {
  '表名.字段名': {
    '英文码1': '中文显示1',
    '英文码2': '中文显示2',
    // ...
  }
};
```

**替换步骤：**

1. 按 `{表名}.{字段名}` 注册你的枚举映射
2. 在 `allEnumMappings` 中解构合并
3. 确保 `rowDims` 的字段经过 `applyEnumMappings` 处理

> 如果业务场景不需要枚举翻译，把 `allEnumMappings` 设为 `{}` 即可关闭。

---

### 3. dataLoader（数据加载）

定义数据从哪里来、如何加载到 DuckDB。位于 `services/dataLoader.js`。

```javascript
async function loadAllDataSources(con) {
  // 从 MySQL / CSV / API 等来源拉取数据
  // 创建 DuckDB 表：con.exec("CREATE TABLE xxx AS SELECT * FROM read_csv('...')")
}
```

**支持的数据源方式：**

| 方式 | 适用场景 |
|---|---|
| `read_csv` | 静态数据文件 |
| `read_parquet` | 列式存储大数据 |
| `ATTACH '...' AS mysql` | 直接连接 MySQL 实时查询 |
| INSERT 逐行写入 | API 回调写入 |

---

### 典型适配流程

以从「写字楼租赁」切换到「电商订单」场景为例：

```
1. 写 resourceDictionary → orders, products, users 等表定义 + relations
2. 写 valuesMapping  → 如 orders.status: 'pending'→'待付款', 'shipped'→'已发货'
3. 写 dataLoader    → 从电商数据库拉数据到 DuckDB
4. 重启服务         → routes/report.js 零改动
5. 发送 DSL 请求    → 自动 JOIN orders → order_items → products
```

**核心原则：引擎不改代码，只换配置。**

---

## 注意事项

| 问题 | 解决方案 |
|---|---|
| filter value 需用英文码 | 底层存英文，返回时自动翻译中文 |
| rowDims 建议用 alias 格式 | 否则 flat 里 rowKeys 可能为空 |
| flat 取值用 `rowKeys[n]` + `colKey` + `value` | 不要直接用字段名访问 |
| IN 的 value 传数组 | `["a", "b"]` 不是 `"a,b"` 也不是 `"a"` |
| 表数量取决于关系图质量 | 边不断、不成环、无笛卡尔积风险则几乎无上限 |
| calcFn 含中文时 | 建议把请求体写文件 `-d @query.json`，避免 shell 编码问题 |

---

## 开源协议

本项目基于 **MIT License** 开源。详见 [LICENSE](./LICENSE) 文件。
