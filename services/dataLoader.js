const mysql = require('mysql2/promise');
const dataSources = require('../dataSource/dataSource');

/**
 * 通用加载函数 - 支持数据类型
 */
async function loadDataSourceToDuckDB(ds, mysqlConn, duckConn, lastUpdated = null) {
    console.log(`[DataLoader] 开始加载数据源: ${ds.name}`);
    const sql = ds.loadSql(lastUpdated);

    const [rows] = await mysqlConn.query(sql);
    if (!rows || rows.length === 0) {
        console.log(`[DataLoader] 数据源 ${ds.name} 无新数据`);
        return;
    }

    // 1. 获取MySQL表结构信息
    const [structure] = await mysqlConn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = '${ds.mysqlTable}' 
        AND TABLE_SCHEMA = DATABASE()
    `);

    const columnTypes = {};
    structure.forEach(col => {
        columnTypes[col.COLUMN_NAME] = col.DATA_TYPE;
    });

    // 2. 类型映射
    const columns = Object.keys(rows[0]).map(k => {
        const mysqlType = columnTypes[k] || 'varchar';
        let duckType = 'VARCHAR';
        
        if (mysqlType.includes('int')) {
            duckType = 'BIGINT';
        } else if (mysqlType.includes('decimal') || mysqlType.includes('float') || mysqlType.includes('double')) {
            duckType = 'DOUBLE';
        } else if (mysqlType.includes('date') || mysqlType.includes('time')) {
            duckType = 'TIMESTAMP';
        } else if (mysqlType.includes('bool')) {
            duckType = 'BOOLEAN';
        }
        
        return `"${k}" ${duckType}`;
    }).join(', ');

    // 3. 重建 DuckDB 表
    await duckConn.run(`DROP TABLE IF EXISTS ${ds.duckTable}`);
    await duckConn.run(`CREATE TABLE ${ds.duckTable} (${columns})`);

    // 4. 批量插入
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        
        const values = chunk.map(row => {
            return '(' + Object.entries(row).map(([key, v]) => {
                if (v === null) return 'NULL';
                const mysqlType = columnTypes[key] || '';
                
                if (mysqlType.includes('date') || mysqlType.includes('time')) {
                    try {
                        const d = new Date(v);
                        const pad = (n) => String(n).padStart(2, '0');
                        
                        const localTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
                        
                        return `'${localTime}'`;
                    } catch (e) {
                        return 'NULL';
                    }
                }else if (mysqlType.includes('int') || mysqlType.includes('decimal') || mysqlType.includes('float')) {
                    return v.toString();
                } else {
                    return `'${v.toString().replace(/'/g, "''")}'`;
                }
            }).join(', ') + ')';
        }).join(', ');

        const keys = Object.keys(rows[0]).map(k => `"${k}"`).join(', ');
        await duckConn.run(`INSERT INTO ${ds.duckTable} (${keys}) VALUES ${values}`);
    }
    console.log(`[DataLoader] 加载完成: ${ds.name}, 共 ${rows.length} 条记录`);
}

/**
 * 全量加载所有数据源
 */
async function loadAllDataSources(duckConn) {
    const mysqlConn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    try {
        for (const ds of dataSources) {
            await loadDataSourceToDuckDB(ds, mysqlConn, duckConn);
        }
    } finally {
        await mysqlConn.end();
    }
}

/**
 * 增量加载某个数据源
 */
async function loadIncremental(duckConn, dsName, lastUpdated) {
    const ds = dataSources.find(d => d.name === dsName);
    if (!ds) throw new Error(`未找到数据源配置: ${dsName}`);
    
    const mysqlConn = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    try {
        await loadDataSourceToDuckDB(ds, mysqlConn, duckConn, lastUpdated);
    } finally {
        await mysqlConn.end();
    }
}

module.exports = {
    loadAllDataSources,
    loadIncremental
};