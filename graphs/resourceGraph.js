const { resourceDictionary } = require("../resources/resourceDictionary");

class ResourceGraph {
    constructor(dict) {
        this.dict = dict;
        this.adj = {};
        this.initGraph();
    }

    initGraph() {
        // 初始化邻接表
        Object.keys(this.dict).forEach(name => (this.adj[name] = []));

        Object.keys(this.dict).forEach(fromNode => {
            const resource = this.dict[fromNode];
            if (resource.relations && resource.relations.length > 0) {
                resource.relations.forEach(rel => {
                    const toNode = rel.type;
                    
                    // 1. 自动计算权重逻辑 (启发式权重)
                    let weight = rel.weight || 1.0;
                    if (['creator', 'updater', 'auditor'].includes(rel.name)) {
                        weight += 5.0; // 系统辅助表路径降权
                    }
                    if (rel.relation_type === 'many_to_many') {
                        weight += 0.5; // 多对多路径略微降权
                    }

                    // 2. 构建边信息
                    const edgeData = {
                        from: fromNode,
                        to: toNode,
                        type: rel.relation_type,
                        on: rel.on,
                        relationName: rel.name,
                        weight: weight
                    };

                    // 正向加入
                    this.adj[fromNode].push({ 
                        to: toNode, 
                        weight: weight, 
                        edge: edgeData, 
                        isReverse: false 
                    });

                    // 反向加入 (反向权重增加 0.1 惩罚)
                    this.adj[toNode].push({ 
                        to: fromNode, 
                        weight: weight + 0.1, 
                        edge: edgeData, 
                        isReverse: true 
                    });
                });
            }
        });
    }

    /**
     * Dijkstra 算法：寻找加权最优路径
     * 解决了 50 张表下 BFS 可能走错“业务歧义路径”的问题
     */
    findPath(start, end) {
        if (!this.adj[start] || !this.adj[end]) return null;

        const distances = { [start]: 0 };
        const parent = {};
        const pq = [{ node: start, dist: 0 }];

        while (pq.length > 0) {
            pq.sort((a, b) => a.dist - b.dist);
            const { node, dist } = pq.shift();

            if (dist > (distances[node] || Infinity)) continue;
            if (node === end) break;

            for (const neighbor of this.adj[node]) {
                const newDist = dist + neighbor.weight;
                if (distances[neighbor.to] === undefined || newDist < distances[neighbor.to]) {
                    distances[neighbor.to] = newDist;
                    parent[neighbor.to] = { from: node, edgeInfo: neighbor };
                    pq.push({ node: neighbor.to, dist: newDist });
                }
            }
        }

        // 回溯路径并注入动态别名
        if (distances[end] === undefined) return null;

        const path = [];
        let curr = end;
        let prevSourceAlias = this.dict[start].alias || start; // 起点表别名

        while (parent[curr]) {
            const { from, edgeInfo } = parent[curr];
            const originalEdge = edgeInfo.edge;
            
            // 动态生成唯一别名：表名_关系名 (确保同一张表多次 Join 也不冲突)
            const targetAlias = `${originalEdge.to}_as_${originalEdge.relationName}`;

            path.unshift({
                ...originalEdge,
                currentSourceAlias: prevSourceAlias, // 当前这一步 Join 的左表别名
                currentTargetAlias: targetAlias,     // 当前这一步 Join 的右表别名
                isReverse: edgeInfo.isReverse,
                stepWeight: edgeInfo.weight
            });

            // 这里的逻辑需要根据路径方向更新别名链条
            // 但因为我们是顺序生成的 SQL，所以简单回溯即可
            curr = from;
        }

        // 路径二次修正：为了保证链条别名连续，我们需要从前往后重新整理别名
        return this.refinePathAliases(start, path);
    }

    // 确保 Join 链条的别名：A -> B_as_rel1 -> C_as_rel2
    refinePathAliases(start, path) {
        let lastAlias = this.dict[start].alias || start;
        return path.map(step => {
            const currentStep = { ...step };
            currentStep.fromAlias = lastAlias;
            currentStep.toAlias = `${step.to}_as_${step.relationName}`;
            lastAlias = currentStep.toAlias;
            return currentStep;
        });
    }

    /**
     * 诊断工具：将路径导出为 Mermaid 流程图代码
     * 解决“黑盒”不可测的问题，直接贴到支持 Mermaid 的编辑器即可看图
     */
    getDebugMermaid(start, end) {
        const path = this.findPath(start, end);
        if (!path) return "No path found";

        let mermaid = `graph LR\n`;
        path.forEach(step => {
            const label = `${step.relationName} (w:${step.stepWeight})`;
            mermaid += `    ${step.fromAlias} -- "${label}" --> ${step.toAlias}\n`;
        });
        return mermaid;
    }
}

const resourceGraph = new ResourceGraph(resourceDictionary);
module.exports = { ResourceGraph, resourceGraph };
