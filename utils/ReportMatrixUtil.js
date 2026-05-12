class ReportMatrixUtil {

    static buildMatrixFromReport(reportData, combinedDims = []) {
        const rows = reportData.rows || [];
        const config = reportData.config || {};

        let rowDims = (config.rowDims || []).map(d => ({ ...d }));
        const colDims = (config.colDims || []).map(d => d.alias);

        const normalMetrics = (config.metrics || []).filter(m => !m.calcFn && !m.calcFnForMatrix);
        const calcMetrics = (config.metrics || []).filter(m => m.calcFn || m.calcFnForMatrix);

        const normalMetricAliases = normalMetrics.map(m => m.alias);

        for (const dim of rowDims) {
            if (dim.combine && Array.isArray(dim.fields)) {
                for (const row of rows) {
                    const combinedValue = dim.fields
                        .map(f => row[f] ?? "")
                        .join(dim.combineWith ?? "-");
                    row[dim.alias] = combinedValue;
                }
            }
        }

        // ---------- 3. 将返回的 combinedDims 转换为新的 rowDims ----------
        if (combinedDims.length > 0) {
            const originalAliases = rowDims.map(d => d.alias);

            combinedDims.forEach(group => {
                if (!group.alias || !Array.isArray(group.fields)) return;

                rowDims = rowDims.filter(d => !group.fields.includes(d.alias));
                const firstIndex = originalAliases.indexOf(group.fields[0]);
                rowDims.splice(firstIndex, 0, {
                    alias: group.alias,
                    field: group.alias,
                    groupBy: true
                });

                for (const r of rows) {
                    if (group.operator) {
                        const values = group.fields.map(f => Number(r[f] ?? 0));
                        let combinedValue = values[0];
                        for (let i = 1; i < values.length; i++) {
                            switch (group.operator) {
                                case "+": combinedValue += values[i]; break;
                                case "-": combinedValue -= values[i]; break;
                                case "*": combinedValue *= values[i]; break;
                                case "/": combinedValue = values[i] !== 0 ? combinedValue / values[i] : null; break;
                            }
                        }
                        r[group.alias] = combinedValue;
                    } else {
                        r[group.alias] = group.fields.map(f => r[f] ?? "").join(group.combineWith || "~");
                    }
                }
            });
        }

        // ---------- 4. 构建 combinedGroups ----------
        const combinedGroups = this._buildCombinedGroups(rowDims, combinedDims);

        // ---------- 5. 构建多维矩阵 ----------
        const matrix = ReportMatrixUtil._buildMatrixWithCombinedGroups(
            rows,
            rowDims.map(d => d.alias),
            colDims,
            normalMetricAliases,
            combinedGroups
        );

        // ---------- 6. 扁平化 ----------
        const flat = ReportMatrixUtil._flattenMatrixWithCombinedGroups(
            matrix,
            rowDims.map(d => d.alias),
            colDims,
            combinedGroups
        );

        // 修改第7步 - 行级计算（只执行 calcFn）
        if (calcMetrics.length > 0) {
            for (const row of flat) {
                for (const metric of calcMetrics) {
                    if (metric.calcFn) {
                        try {
                            let result;
                            if (typeof metric.calcFn === 'string') {
                                const fn = eval(`(${metric.calcFn})`);
                                result = fn(row);
                            } else {
                                result = metric.calcFn(row);
                            }
                            row[metric.alias] = result;
                        } catch (e) {
                            row[metric.alias] = null;
                            console.error(`calcFn error for metric ${metric.alias}:`, e);
                        }
                    }
                }
            }
        }

        // 修改第8步 - 矩阵级计算（只执行 calcFnForMatrix）
        if (calcMetrics.length > 0) {
            for (const metric of calcMetrics) {
                if (metric.calcFnForMatrix) {
                    try {
                        let result;
                        if (typeof metric.calcFnForMatrix === 'string') {
                            const fn = eval(`(${metric.calcFnForMatrix})`);
                            result = fn(flat);
                        } else {
                            result = metric.calcFnForMatrix(flat);
                        }

                        if (!result || typeof result !== 'object') continue;

                        // ===== 通用合并 =====
                        // 获取结果对象的深度（最深层为叶子值）
                        const getDepth = (obj, currentDepth = 0) => {
                            if (!obj || typeof obj !== 'object') return currentDepth;
                            return Math.max(...Object.values(obj).map(v => getDepth(v, currentDepth + 1)));
                        };
                        const resultDepth = getDepth(result);

                        // 叶子值应当出现在深度 resultDepth 的位置，对应 rowKeys 的前 resultDepth 项
                        // 例如 depth=1 时，rowKeys[0] 作为键；depth=2 时，rowKeys[0] 和 rowKeys[1] 依次作为键

                        // 遍历 flat，为每个条目设置值
                        flat.forEach(item => {
                            let value = result;
                            let current = result;
                            let matched = true;
                            for (let i = 0; i < resultDepth; i++) {
                                const key = item.rowKeys[i];
                                if (current && typeof current === 'object' && key in current) {
                                    current = current[key];
                                } else {
                                    matched = false;
                                    break;
                                }
                            }
                            if (matched && (typeof current === 'string' || typeof current === 'number')) {
                                // 将值挂载到 flat 条目上
                                item[metric.alias] = current;

                                // 同时更新 matrix 中对应位置
                                let matrixNode = matrix;
                                for (let i = 0; i < item.rowKeys.length; i++) {
                                    const key = item.rowKeys[i];
                                    if (!matrixNode[key]) matrixNode[key] = {};
                                    matrixNode = matrixNode[key];
                                }
                                // matrixNode 现在指向最内层对象（单元），将指标值赋给它
                                matrixNode[metric.alias] = current;
                            }
                        });

                        // 对于无法通过 rowKeys 匹配的值（如全局值），单独处理
                        // 例如，如果结果只有一个键且不是任何 rowKeys 第一层的值，则作为全局值复制到所有单元
                        const keys = Object.keys(result);
                        const firstLevelValues = new Set(flat.map(item => item.rowKeys[0]));
                        if (keys.length === 1 && !firstLevelValues.has(keys[0])) {
                            const globalValue = result[keys[0]];
                            flat.forEach(item => {
                                item[metric.alias] = globalValue;
                                let matrixNode = matrix;
                                for (let i = 0; i < item.rowKeys.length; i++) {
                                    const key = item.rowKeys[i];
                                    matrixNode = matrixNode[key];
                                }
                                matrixNode[metric.alias] = globalValue;
                            });
                        }

                        // 注意：这里不保留 matrix[metric.alias] 根节点，避免冗余
                    } catch (e) {
                        console.error(`Matrix calcFn error for metric ${metric.alias}:`, e);
                    }
                }
            }
        }

        // ---------- 9. 返回 ----------
        return {
            matrix,
            flat,
            combinedInfo: combinedGroups,
            finalRowDims: rowDims.map(d => d.alias)
        };
    }

    /** 构建合并组信息 */
    static _buildCombinedGroups(originalRowDims, combinedDims) {
        const groups = [];
        const allDimAliases = originalRowDims.map(d => d.alias);

        combinedDims.forEach(combinedDim => {
            if (combinedDim.alias && Array.isArray(combinedDim.fields)) {
                const indices = combinedDim.fields
                    .map(field => allDimAliases.indexOf(field))
                    .filter(idx => idx !== -1)
                    .sort((a, b) => a - b);

                if (indices.length >= 2) {
                    groups.push({
                        alias: combinedDim.alias,
                        fields: combinedDim.fields,
                        combineWith: combinedDim.combineWith || '~',
                        indices: indices,
                        combinedKey: combinedDim.combinedKey || combinedDim.alias
                    });
                }
            }
        });

        return groups;
    }

    static _buildMatrixWithCombinedGroups(rows, rowDims, colDims, metrics, combinedGroups) {
        const matrix = {};
        const formatDate = (value) => {
            if (value instanceof Date) {
                const y = value.getFullYear();
                const m = String(value.getMonth() + 1).padStart(2, '0');
                const d = String(value.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
            return value;
        };
        const isLikelyDate = (value) => value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value));

        for (const row of rows) {
            let current = matrix;
            let processedIndices = new Set();
            let i = 0;

            while (i < rowDims.length) {
                const dim = rowDims[i];
                const group = this._findGroupContainingIndex(combinedGroups, i);

                if (group && !processedIndices.has(i)) {
                    const combinedValue = group.fields
                        .map(f => {
                            let value = row[f] ?? "";
                            if (isLikelyDate(value)) value = formatDate(value);
                            return value;
                        })
                        .join(group.combineWith);
                    if (!current[combinedValue]) current[combinedValue] = {};
                    current = current[combinedValue];

                    group.indices.forEach(idx => processedIndices.add(idx));
                    i += group.indices.length;
                } else if (!processedIndices.has(i)) {
                    let key = row[dim] ?? "__undefined__";
                    if (isLikelyDate(key)) key = formatDate(key);
                    if (!current[key]) current[key] = {};
                    current = current[key];
                    i++;
                } else {
                    i++;
                }
            }

            // 指标累加
            if (colDims.length > 0) {
                for (const col of colDims) {
                    let colKey = row[col] ?? "__undefined__";
                    if (isLikelyDate(colKey)) colKey = formatDate(colKey);
                    if (!current[colKey]) current[colKey] = 0;

                    if (metrics.length > 0) {
                        for (const metric of metrics) {
                            current[colKey] += row[metric] ?? 0;
                        }
                    } else current[colKey] += 1;
                }
            } else {
                if (metrics.length > 0) {
                    for (const metric of metrics) {
                        if (!current[metric]) current[metric] = 0;
                        current[metric] += row[metric] ?? 0;
                    }
                } else {
                    if (!current["count"]) current["count"] = 0;
                    current["count"] += 1;
                }
            }
        }

        return matrix;
    }

    static _flattenMatrixWithCombinedGroups(matrix, rowDims, colDims, combinedGroups, metrics = []) {
        const result = [];

        function recurse(current, rowKeys = [], depth = 0) {
            if (depth < rowDims.length) {
                const group = ReportMatrixUtil._findGroupByStartIndex(combinedGroups, depth);
                if (group) {
                    for (const key of Object.keys(current)) {
                        recurse(current[key], [...rowKeys, key], depth + group.indices.length);
                    }
                } else {
                    for (const key of Object.keys(current)) {
                        recurse(current[key], [...rowKeys, key], depth + 1);
                    }
                }
            } else {
                if (colDims.length > 0) {
                    for (const colKey of Object.keys(current)) {
                        // 找到对应的 metric alias
                        const metric = metrics.find(m => m.alias === colKey);
                        const alias = metric ? metric.alias : colKey;

                        result.push({
                            rowKeys,
                            colKey,
                            alias,
                            value: current[colKey]
                        });
                    }
                } else {
                    for (const metricKey of Object.keys(current)) {
                        const metric = metrics.find(m => m.alias === metricKey);
                        const alias = metric ? metric.alias : metricKey;

                        result.push({
                            rowKeys,
                            colKey: metricKey,
                            alias,
                            value: current[metricKey]
                        });
                    }
                }
            }
        }

        recurse(matrix);
        return result;
    }

    static _findGroupContainingIndex(groups, index) {
        return groups.find(g => g.indices.some(idx => idx === index));
    }

    static _findGroupByStartIndex(groups, index) {
        return groups.find(g => g.indices.length > 0 && g.indices[0] === index);
    }

    static _buildMatrix(rows, rowDims = [], colDims = [], metrics = []) {
        return this._buildMatrixWithCombinedGroups(rows, rowDims, colDims, metrics, []);
    }

    static _flattenMatrix(matrix, rowDims = [], colDims = []) {
        return this._flattenMatrixWithCombinedGroups(matrix, rowDims, colDims, []);
    }
}

module.exports = ReportMatrixUtil;