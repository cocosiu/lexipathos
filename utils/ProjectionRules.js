const ReportSemanticProjection = require('./ReportSemanticProjection');

// 模拟请求规则
const reportConfig = {
    rowDims: [
        { field: 'buildings.name', groupBy: true, alias: '项目' },
        { field: 'units.lease_area', groupBy: false, alias: '面积' },
        { field: 'units.code', groupBy: false, alias: '单元号' },
        { field: 'units.status', groupBy: false, alias: '单元状态' }
    ],
    combinedDims: [
        {
            alias: '已出租面积',
            fields: ['面积', '单元状态'],
            mode: 'calcFn',
            displayInRow: true,
            calcFn: "(row) => ['已出租'].includes(row['单元状态']) ? row['面积'] : 0"
        },
        {
            alias: '未出租面积',
            fields: ['面积', '单元状态'],
            mode: 'calcFn',
            displayInRow: true,
            calcFn: "(row) => row['单元状态'] === '空置' ? row['面积'] : 0"
        },
        {
            alias: '出租率',
            fields: ['已出租面积', '未出租面积'],
            mode: 'calcFn',
            displayInRow: true,
            calcFn: `(row, allRows) => {
                const projectRows = allRows.filter(r => r['项目'] === row['项目']);
                const leased = projectRows.reduce((s,r)=>s+(parseFloat(r['已出租面积'])||0),0);
                const vacant = projectRows.reduce((s,r)=>s+(parseFloat(r['未出租面积'])||0),0);
                const total = leased+vacant;
                return total>0?((leased/total)*100).toFixed(2)+'%':'0.00%';
            }`
        }
    ]
};

// 模拟请求完成后的 rows
const rows = [
    { 项目: '环球都会广场', 面积: 100, 单元号: 'U001', 单元状态: '已出租' },
    { 项目: '环球都会广场', 面积: 50, 单元号: 'U002', 单元状态: '空置' },
    { 项目: '环球都会广场', 面积: 80, 单元号: 'U003', 单元状态: '已出租' },
    { 项目: '环球都会广场', 面积: 70, 单元号: 'U004', 单元状态: '空置' },
    { 项目: '中心广场', 面积: 120, 单元号: 'U005', 单元状态: '已出租' },
    { 项目: '中心广场', 面积: 30, 单元号: 'U006', 单元状态: '空置' }
];

// 初始化语义投影
const projection = new ReportSemanticProjection(reportConfig);

// 输出生成的投影规则
console.log('=== Projection Rules ===');
console.log(projection.getProjectionRules());

// 执行投影计算
const newRows = projection.applyProjection(rows);

console.log('=== Rows After Projection ===');
console.table(newRows);