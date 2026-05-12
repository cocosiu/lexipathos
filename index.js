require('dotenv').config();
const express = require('express');
const duckdb = require('duckdb');
const cors = require('cors');
const { loadAllDataSources, loadIncremental } = require('./services/dataLoader');
const reportModule = require('./routes/report');

const PORT = process.env.PORT || 3002;

// DuckDB 初始化
const db = new duckdb.Database(':memory:');
const con = db.connect();

// 将 DuckDB 连接注入到路由模块
reportModule.setConnection(con);

const app = express();
app.use(express.json());

// 跨域配置
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));

// 挂载报表路由
app.use('/api/report', reportModule.router);

// 增量加载接口
app.post('/api/incremental', async (req, res) => {
    const { dataSource, lastUpdated } = req.body;
    if (!dataSource || !lastUpdated) return res.status(400).json({ success: false, error: '参数缺失' });

    try {
        await loadIncremental(con, dataSource, new Date(lastUpdated));
        res.json({ success: true, message: '增量加载完成' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 启动服务前先加载数据
loadAllDataSources(con).then(() => {
    app.listen(PORT, () => {
        console.log(`DuckDB 数据透视服务已启动，端口: ${PORT}`);
    });
}).catch(err => {
    console.error('服务启动初始化失败:', err);
});

// 导出 con 以备不时之需
module.exports = { con };