const express = require('express');
const router = express.Router();
const { getFieldType } = require('../mapper/data_type_mapper');
const { applyEnumMappings } = require('../mapper/values_mapping');
const ReportMatrixUtil = require('../utils/ReportMatrixUtil');
const { loadAllDataSources } = require('../services/dataLoader');

let resourceDictionary = {};
try {
    const dictModule = require('../resources/resourceDictionary');
    resourceDictionary = dictModule.resourceDictionary || dictModule.default || dictModule;
} catch (error) {
    resourceDictionary = {};
}

let con; 

function setConnection(connection) {
    con = connection;
}

/**
 * 保持您原始的序列化逻辑
 */
function serializeRows(rows) {
    return rows.map(row => {
        const newRow = {};
        for (const key in row) {
            newRow[key] = (typeof row[key] === 'bigint') ? Number(row[key]) : row[key];
        }
        return newRow;
    });
}

/**
 * 元数据资源接口 - 保持原始 rows 返回结构
 */
router.get('/resources', async (req, res) => {
    try {
        const { tableName } = req.query;
        let tables = [];
        if (tableName) {
            tables = [tableName];
        } else {
            tables = await new Promise((resolve, reject) => {
                con.all(`SHOW TABLES`, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows ? rows.map(r => r.name) : []);
                });
            });
        }

        const resources = [];
        for (const table of tables) {
            const dbFields = await new Promise((resolve, reject) => {
                con.all(`PRAGMA table_info('${table}')`, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
            });

            const tableDict = resourceDictionary[table];
            const fieldNamesToInclude = (tableDict && tableDict.defaultFields && tableDict.defaultFields.length > 0)
                ? tableDict.defaultFields
                : dbFields.map(f => f.name);

            const fields = [];
            for (const fieldName of fieldNamesToInclude) {
                const dbField = dbFields.find(f => f.name === fieldName);
                if (!dbField) continue;

                const fieldDict = tableDict?.fields?.[fieldName];
                fields.push({
                    name: fieldName,
                    value: `${table}.${fieldName}`,
                    label: fieldDict?.label || fieldName,
                    description: fieldDict?.description || '',
                    datatype: getFieldType(table, fieldName) || 'string'
                });
            }

            resources.push({
                table,
                alias: tableDict?.label || table,
                description: tableDict?.description || '',
                fields
            });
        }
        // 保持原始返回格式
        res.json({ success: true, resources });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * 报表执行接口 - 严格保持原始返回字段：rows, matrix, flat, total
 */
router.post('/execute', async (req, res) => {
    const reportJson = req.body;
    if (!reportJson) return res.status(400).json({ success: false, message: '配置缺失' });

    let builder;
    try {
        const ReportBuilder = require('../builder/ReportBuilder');
        builder = new ReportBuilder({ con });
        builder.loadFromJson(reportJson);
        builder.autoGenerateJoins();

        const sql = builder.buildSQL();
        let rows = await builder.execute();

        rows = serializeRows(rows);
        rows = applyEnumMappings(rows);

        const { matrix, flat, combinedInfo } = ReportMatrixUtil.buildMatrixFromReport({
            rows,
            config: reportJson
        }, reportJson.combinedDims || []);

        res.json({ 
            success: true, 
            rows,
            matrix,
            flat,
            total: rows.length,
            sql,
            combinedInfo,
            config: reportJson
        });
    } catch (err) {
        console.error('生成报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * 缓存同步接口
 */
router.get('/refresh_cacheDB', async (req, res) => {
    try {
        await loadAllDataSources(con);
        res.json({ success: true, message: '缓存刷新成功' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = { router, setConnection };