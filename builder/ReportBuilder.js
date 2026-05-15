const { resourceGraph } = require('../graphs/resourceGraph');
const { resourceDictionary } = require('../resources/resourceDictionary');
class ReportBuilder {
    constructor({ con } = {}) {
        this.con = con;
        this.dataSources = []; // [{ table, alias }]
        this.joins = [];       // [{ leftAlias, rightAlias, on, type }]
        this.rowDims = [];
        this.colDims = [];
        this.metrics = []; // [{ field, agg, alias, expr }]
        this.filters = []; // [{ field, op, value }]
        this.limit = 100;
        this.orderBy = null;
        this.totalEnabled = false;
    }

    _isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
    _safeArray(v) { return Array.isArray(v) ? v : []; }
    _safeObject(v) { return v && typeof v === 'object' ? v : {}; }
    _safeString(v, def = '') { return this._isNonEmptyString(v) ? v : def; }

    addDataSource({ table, alias } = {}) {
        const autoAlias = `t${this.dataSources.length + 1}`;
        this.dataSources.push({
            table: this._safeString(table),
            alias: this._safeString(alias, autoAlias)
        });
        return this;
    }

    addJoin({ leftAlias, rightAlias, on, type = 'INNER' } = {}) {
        this.joins.push({
            leftAlias: this._safeString(leftAlias),
            rightAlias: this._safeString(rightAlias),
            on: this._safeString(on),
            type: this._safeString(type, 'INNER').toUpperCase()
        });
        return this;
    }

    setRowDims(fields) { this.rowDims = this._safeArray(fields); return this; }
    setColDims(fields) { this.colDims = this._safeArray(fields); return this; }
    addMetric({ field = null, agg = 'SUM', alias = null, expr = null, condition = null } = {}) {
        this.metrics.push({
            field,
            agg: (agg || '').toUpperCase(),
            alias: alias || (agg ? `${agg.toLowerCase()}_${this.metrics.length + 1}` : `m${this.metrics.length + 1}`),
            expr,
            condition
        });
        return this;
    }
    addFilter(filter = {}) { this.filters.push(filter); return this; }
    setLimit(limit) { this.limit = Number.isFinite(limit) ? parseInt(limit, 10) : this.limit; return this; }
    setOrderBy(orderBy) { this.orderBy = orderBy && typeof orderBy === 'object' ? orderBy : null; return this; }
    enableTotal() { this.totalEnabled = true; return this; }

    loadFromJson(json = {}) {
        this.dataSources = [];
        this.joins = [];
        this.rowDims = [];
        this.colDims = [];
        this.metrics = [];
        this.filters = [];
        this.orderBy = null;
        this.totalEnabled = false;
        this.limit = json.limit || this.limit;

        this._safeArray(json.dataSources).forEach(ds => this.addDataSource({ table: ds.table, alias: ds.alias }));
        this._safeArray(json.joins).forEach(j => this.addJoin(j));
        if (Array.isArray(json.rowDims)) this.setRowDims(json.rowDims);
        if (Array.isArray(json.colDims)) this.setColDims(json.colDims);
        this._safeArray(json.metrics).forEach(m => this.addMetric(m));
        this._safeArray(json.filters).forEach(f => this.addFilter({
            field: f.field, op: f.op || '=', value: f.value
        }));
        if (json.orderBy && this._isNonEmptyString(json.orderBy.field)) {
            this.setOrderBy({ field: json.orderBy.field, direction: json.orderBy.direction || 'ASC' });
        } else {
            this.orderBy = null;
        }
        if (json.totalEnabled === true) this.enableTotal();

        return this;
    }

    autoGenerateJoins(graph = resourceGraph) {
        const aliasMap = {};
        let aliasIndex = 1;
        const usedAliases = new Set();
    
        // --- 第一步：锁定初始表的 Alias ---
        // 无论用户有没有传 alias，先统一清理并标记
        this.dataSources.forEach(ds => {
            if (!ds.alias) {
                const dictAlias = resourceDictionary[ds.table]?.alias;
                // 只有当字典别名没被占用时才使用
                if (dictAlias && !usedAliases.has(dictAlias)) {
                    ds.alias = dictAlias;
                } else {
                    // 自动分配一个不冲突的
                    let newAlias;
                    do { newAlias = `t${aliasIndex++}`; } while (usedAliases.has(newAlias));
                    ds.alias = newAlias;
                }
            }
            aliasMap[ds.table] = ds.alias;
            usedAliases.add(ds.alias);
        });
    
        // --- 第二步：路径探测，确定所有中间表 ---
        const requiredTables = new Set(Object.keys(aliasMap));
        const initialTables = Array.from(requiredTables);
    
        for (let i = 0; i < initialTables.length - 1; i++) {
            for (let j = i + 1; j < initialTables.length; j++) {
                const pathEdges = graph.findPath(initialTables[i], initialTables[j]);
                if (pathEdges) {
                    pathEdges.forEach(edge => {
                        requiredTables.add(edge.from);
                        requiredTables.add(edge.to);
                    });
                }
            }
        }
    
        // --- 第三步：为补出来的中间表分配 Alias (关键修复点) ---
        requiredTables.forEach(table => {
            if (!aliasMap[table]) {
                let alias;
                const dictAlias = resourceDictionary[table]?.alias;
                
                if (dictAlias && !usedAliases.has(dictAlias)) {
                    alias = dictAlias;
                } else {
                    do { alias = `t${aliasIndex++}`; } while (usedAliases.has(alias));
                }
                
                aliasMap[table] = alias;
                usedAliases.add(alias);
                
                // 诚实地推入 dataSources，保证 buildSQL 能找到所有表
                this.dataSources.push({ table, alias });
                console.log(`[自动补表锁定]: ${table} AS ${alias}`);
            }
        });
    
        // --- 第四步：根据锁定好的 Alias 生成 JOIN ---
        const joinKeys = new Set();
        const allTables = Array.from(requiredTables);
    
        for (let i = 0; i < allTables.length - 1; i++) {
            for (let j = i + 1; j < allTables.length; j++) {
                const pathEdges = graph.findPath(allTables[i], allTables[j]);
                if (!pathEdges) continue;
    
                pathEdges.forEach(edge => {
                    const leftAlias = aliasMap[edge.from];
                    const rightAlias = aliasMap[edge.to];
                    
                    // 严格防重：A-B 和 B-A 视为同一个 JOIN
                    const key = [leftAlias, rightAlias].sort().join('__');
                    if (joinKeys.has(key)) return;
                    joinKeys.add(key);
    
                    // 替换 ON 条件
                    const onExpr = edge.on
                        .replace(new RegExp(`\\b${edge.from}\\b`, 'g'), leftAlias)
                        .replace(new RegExp(`\\b${edge.to}\\b`, 'g'), rightAlias);
    
                    this.addJoin({ leftAlias, rightAlias, on: onExpr, type: 'INNER' });
                    console.log(`[JOIN执行]: ${leftAlias} -> ${rightAlias}`);
                });
            }
        }
    }

    buildSQL() {
        if (!this.dataSources || this.dataSources.length === 0)
            throw new Error('至少需要一个数据源');
        if ((this.rowDims.length === 0 && this.colDims.length === 0) && (this.metrics.length === 0))
            throw new Error('至少需要一个维度或指标');

        // --- 构建表别名映射 ---
        const tableAliasMap = {};
        this.dataSources.forEach(ds => {
            if (!ds.table) return;
            tableAliasMap[ds.table] = ds.alias || ds.table;
        });

        const resolveField = (rawField) => {
            if (!rawField) return null;
            // 为放行COUNT(*)
            if (rawField === '*') return '*'; 
            const parts = String(rawField).trim().split('.');
            if (parts.length === 2) {
                const tableAlias = tableAliasMap[parts[0]];
                if (!tableAlias) throw new Error(`找不到表 ${parts[0]} 的别名映射`);
                return `${tableAlias}.${parts[1]}`;
            }
            if (this.dataSources.length === 1) {
                const only = this.dataSources[0];
                return `${only.alias || only.table}.${rawField}`;
            }
            throw new Error(`字段 "${rawField}" 缺少表前缀且存在多个数据源`);
        };

        // --- 判断是否聚合模式 ---
        const isAggregateMode = this.metrics.length > 0;

        // --- 构建 SELECT ---
        const selectFields = [];
        const groupByFields = [];
        const dims = [...this.rowDims, ...this.colDims];

        dims.forEach(dim => {
            const isObj = typeof dim === 'object' && dim !== null;
            const field = isObj ? dim.field : dim;
            const alias = isObj ? (dim.alias || String(field).replace(/\./g, '_')) : String(field).replace(/\./g, '_');
            const resolved = resolveField(field);

            if (!isAggregateMode) {
                selectFields.push(`${resolved} AS ${alias}`);
            } else if (isObj && dim.groupBy === false) {
                // 不参与 GROUP BY，使用 ANY_VALUE
                selectFields.push(`ANY_VALUE(${resolved}) AS ${alias}`);
            } else {
                groupByFields.push(resolved);
                selectFields.push(`${resolved} AS ${alias}`);
            }
        });


        // --- SQL 指标分流 ---
        const sqlMetrics = this.metrics.filter(m => {
            // 排除计算指标
            if (m.calcFn || m.calcFnForMatrix) return false;
            const agg = (m.agg || 'SUM').toUpperCase();
            // COUNT 允许没有 field（默认使用 COUNT(*)）
            if (agg === 'COUNT') return true;
            // 其他聚合必须有 field
            return !!m.field;
        });

        // --- 聚合指标 ---
        sqlMetrics.forEach((m, idx) => {
            const ALLOWED_AGG = new Set(['SUM', 'COUNT', 'AVG', 'MAX', 'MIN']);
            const agg = (m.agg || 'SUM').toUpperCase();
            if (!ALLOWED_AGG.has(agg)) throw new Error(`非法聚合函数: ${m.agg}`);

            const alias = m.alias || `${agg.toLowerCase()}_${idx + 1}`;

            let fieldExpr;

            if (agg === 'COUNT' && !m.field) {
                fieldExpr = '*'; // 无字段的 COUNT 使用 *
            } else {
                // 其他情况必须通过 resolveField 解析
                fieldExpr = resolveField(m.field);
            }

            const formatValue = (v) => {
                if (v === null) return 'NULL';
                if (typeof v === 'number') return v;
                if (typeof v === 'boolean') return v ? 1 : 0;
                return `'${String(v).replace(/'/g, "''")}'`;
            };

            const buildCondition = (cond) => {
                const { field, op = '=', value } = cond;
                const condField = this.processFieldForMetricSafe(field, tableAliasMap);
                return `${condField} ${op} ${formatValue(value)}`;
            };

            if (m.condition) {
                const condStr = buildCondition(m.condition);
                if (agg === 'COUNT') {
                    // COUNT 使用 CASE WHEN 包裹
                    selectFields.push(`COUNT(CASE WHEN ${condStr} THEN 1 END) AS ${alias}`);
                } else {
                    // 其他聚合函数使用 CASE WHEN ELSE 0
                    const expr = `CASE WHEN ${condStr} THEN ${fieldExpr} ELSE 0 END`;
                    selectFields.push(`${agg}(CAST(${expr} AS DOUBLE)) AS ${alias}`);
                }
            } else {
                // 没有 condition
                if (agg === 'COUNT') {
                    selectFields.push(`COUNT(${fieldExpr}) AS ${alias}`);
                } else {
                    selectFields.push(`${agg}(CAST(${fieldExpr} AS DOUBLE)) AS ${alias}`);
                }
            }
        });

        // --- FROM + JOIN ---
        const main = this.dataSources[0];
        let fromClause = `${main.table} ${main.alias || main.table}`;
        for (const j of this._safeArray(this.joins)) {
            if (!j || !j.rightAlias) continue;
            const joinDs = this.dataSources.find(ds => ds.alias === j.rightAlias);
            if (!joinDs) continue;
            const joinTable = joinDs.table;
            const joinAlias = joinDs.alias || joinTable;
            const joinType = (j.type || 'INNER').toUpperCase();
            const onCond = j.on && j.on.trim() ? j.on : '1=1';
            fromClause += ` ${joinType} JOIN ${joinTable} ${joinAlias} ON ${onCond}`;
        }

        // --- WHERE ---
        let whereClause = '';
        if (this.filters && this.filters.length) {
            const conditions = this.filters.map(f => {
                if (!f || !f.field) return null;
                const op = (f.op || '=').toUpperCase();
                const val = f.value;
                const resolvedField = resolveField(f.field);
                if (!resolvedField) return null;
                if (op === 'IN') {
                    const arr = Array.isArray(val) ? val : String(val).split(',').map(s => s.trim()).filter(Boolean);
                    return `${resolvedField} IN (${arr.map(v => `'${v}'`).join(',')})`;
                } else if (op === 'BETWEEN') {
                    if (Array.isArray(val) && val.length === 2) return `${resolvedField} BETWEEN '${val[0]}' AND '${val[1]}'`;
                    throw new Error('BETWEEN 需要两个值的数组');
                } else if (op === 'IS' && val === null) return `${resolvedField} IS NULL`;
                else return `${resolvedField} ${op} '${val}'`;
            }).filter(Boolean);
            if (conditions.length) whereClause = `WHERE ${conditions.join(' AND ')}`;
        }

        // --- GROUP BY ---
        let groupByClause = '';
        if (isAggregateMode && groupByFields.length) {
            groupByClause = `GROUP BY ${groupByFields.join(', ')}`;
        }

        // --- ORDER BY ---
        const orderByClause = (this.orderBy && this.orderBy.field)
            ? `ORDER BY ${resolveField(this.orderBy.field)} ${(this.orderBy.direction || 'ASC').toUpperCase()}`
            : '';

        return `
            SELECT ${selectFields.join(', ')}
            FROM ${fromClause}
            ${whereClause}
            ${groupByClause}
            ${orderByClause}
            LIMIT ${this.limit}
        `;
    }

    processFieldForMetricSafe(field, tableAliasMap = {}) {
        if (!field) return '*';
        const f = String(field).trim();
        if (f === '*') return '*';
        const parts = f.split('.');
        if (parts.length === 2) {
            const tablePart = parts[0];
            const colPart = parts[1];
            const alias = tableAliasMap[tablePart];
            if (!alias) {
                if (this.dataSources.length === 1) {
                    const only = this.dataSources[0];
                    return `${only.alias || only.table}.${colPart}`;
                }
                throw new Error(`找不到表 ${tablePart} 的别名映射`);
            }
            return `${alias}.${colPart}`;
        }
        // no table part
        if (this.dataSources.length === 1) {
            const only = this.dataSources[0];
            return `${only.alias || only.table}.${f}`;
        }
        throw new Error(`指标字段 "${f}" 缺少表前缀且存在多个数据源，无法自动推断所属表`);
    }

    async execute() {
        const sql = this.buildSQL();
        console.log('Generated SQL:\n', sql);

        if (!this.con || typeof this.con.all !== 'function') {
            throw new Error('缺少有效的 DB 连接：this.con');
        }

        return new Promise((resolve, reject) => {
            this.con.all(sql, (err, rows) => {
                if (err) return reject(err);

                // 如果 totalEnabled，追加汇总行
                if (this.totalEnabled && rows.length) {
                    const totalRow = {};

                    // 维度列显示汇总
                    this.rowDims.forEach(dim => {
                        totalRow[dim.alias] = '汇总';
                    });

                    // 指标列求和
                    this.metrics.forEach(m => {
                        const key = m.alias;
                        totalRow[key] = rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
                    });

                    // 追加汇总行
                    rows.push(totalRow);
                }

                resolve(rows);
            });
        });
    }
}

module.exports = ReportBuilder;
