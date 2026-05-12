class ReportSemanticProjection {
    constructor(reportConfig) {
        this.rowDims = (reportConfig.rowDims || []).map(d => ({ ...d }));
        this.colDims = (reportConfig.colDims || []).map(d => ({ ...d }));
        this.metrics = (reportConfig.metrics || []).map(m => ({ ...m }));
        this.combinedDims = (reportConfig.combinedDims || []).map(cd => ({ ...cd }));

        // 元运算规则列表
        this.projectionRules = [];

        // 初始化语义投影
        this._buildProjectionRules();
    }

    _buildProjectionRules() {
        // 先处理 rowDims
        for (const dim of this.rowDims) {
            this.projectionRules.push({
                alias: dim.alias,
                type: 'dim',
                fields: [dim.field],
                mode: dim.groupBy ? 'groupBy' : 'raw',
            });
        }

        // 再处理 combinedDims
        for (const cd of this.combinedDims) {
            if (!cd.alias || !Array.isArray(cd.fields)) continue;

            let fn = null;
            if (cd.mode === 'calcFn' && cd.calcFn) {
                if (typeof cd.calcFn === 'string') {
                    try {
                        fn = new Function('row', 'allRows', `return (${cd.calcFn})(row, allRows);`);
                    } catch (err) {
                        console.warn('calcFn解析失败', cd.alias, err);
                        fn = null;
                    }
                } else if (typeof cd.calcFn === 'function') {
                    fn = cd.calcFn;
                }
            }

            this.projectionRules.push({
                alias: cd.alias,
                type: 'combined',
                fields: cd.fields,
                mode: cd.mode || 'combine',
                operator: cd.operator || null,
                combineWith: cd.combineWith || '~',
                calcFn: fn,
                displayInRow: cd.displayInRow !== false
            });
        }
    }

    /**
     * 获取语义投影规则
     * @returns {Array<Object>} 投影规则数组
     */
    getProjectionRules() {
        return this.projectionRules;
    }

    /**
     * 在实际 rows 可用时，根据投影规则计算衍生维度
     * @param {Array<Object>} rows
     * @returns {Array<Object>} 新 rows
     */
    applyProjection(rows) {
        const newRows = rows.map(r => ({ ...r }));

        for (const rule of this.projectionRules) {
            if (rule.type === 'combined' && rule.displayInRow) {
                for (const r of newRows) {
                    if (rule.mode === 'calcFn' && typeof rule.calcFn === 'function') {
                        r[rule.alias] = rule.calcFn(r, newRows);
                    } else if (rule.operator) {
                        const values = rule.fields.map(f => Number(r[f] ?? 0));
                        let val = values[0];
                        for (let i = 1; i < values.length; i++) {
                            switch (rule.operator) {
                                case '+': val += values[i]; break;
                                case '-': val -= values[i]; break;
                                case '*': val *= values[i]; break;
                                case '/': val = values[i] !== 0 ? val / values[i] : null; break;
                            }
                        }
                        r[rule.alias] = val;
                    } else {
                        r[rule.alias] = rule.fields.map(f => r[f] ?? '').join(rule.combineWith);
                    }
                }
            }
        }

        return newRows;
    }
}

module.exports = ReportSemanticProjection;