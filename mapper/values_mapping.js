67ea73619ee721c1ecce9ae9ae1936eec782ae80
const units_enum_mapping = {
    'units.status': {
        'unpartitioned': '未分割',
        'vacant': '空置',
        'leased': '已出租',
        'reserved': '已预定',
        'merged': '已合并',
        'split': '已分割'
    },
    'units.area_type': {
        '建面出租': '建面出租',
        '实测出租': '实测出租',
        '合同出租': '合同出租'
    },
    'units.deleted': {
        '0': '否',
        '1': '是',
        false: '否',
        true: '是'
    },
    'units.is_deleted': {
        '0': '否',
        '1': '是',
        false: '否',
        true: '是'
    },
};

const customer_enum_mapping = {
    'customers.customer_type': {
        'individual': '个人',
        'company': '公司'
    },
    'customers.gender': {
        'male': '男',
        'female': '女',
        'other': '其他'
    },
    'customers.status': {
        'normal': '普通客户',
        'potential': '潜在客户',
        'intent': '意向客户',
        'signed': '签约客户',
        'lost': '流失客户'
    },
    'customers.site_selection_progress': {
        'market_research': '了解市场',
        'broad_selection': '海选阶段',
        'comparison': '对比阶段',
        'locked': '锁定目标'
    },
    'customers.expected_move_in': {
        'within_1_month': '1个月内',
        'within_2_months': '2个月内',
        'within_3_months': '3个月内',
        'within_6_months': '6个月内',
        'specific_date': '具体日期',
        'unknown': '未知'
    },
    'customers.rental_mode': {
        'co_working': '联合办公',
        'whole_rent': '整租'
    },
    'customers.is_agent_customer': {
        '0': '否',
        '1': '是',
        false: '否',
        true: '是'
    },
    'customers.follow_up_stage': {
        'first_visit': '初次来访',
        'second_visit': '二次来访',
        'negotiation': '谈判阶段',
        'deal': '成交阶段',
        'lost': '流失阶段'
    },
    'customers.use_reason': {
        'relocation': '搬迁',
        'new': '新增'
    },
    'customers.use_reason_detail': {
        'expansion': '扩租',
        'downsizing': '缩租',
        'temporary': '临时',
        'new_company': '新设公司',
        'new_branch_remote': '异地新设分公司',
        'new_branch_local': '本地新设分公司'
    },
    'customers.decision_role': {
        'staff': '普通员工',
        'manager': '部门经理',
        'shareholder': '公司股东',
        'admin': '行政人员',
        'final_decision': '最终决策者',
        'unknown': '未知'
    },
    'customers.visitor_personality': {
        'fox': '狐狸型（精明）',
        'donkey': '驴子型（固执）',
        'sheep': '绵羊型（温和）',
        'eagle': '鹰型（强势）'
    },
    'customers.is_deleted': {
        '0': '否',
        '1': '是',
        false: '否',
        true: '是'
    },
    'customers.is_locked': {
        '0': '可编辑',
        '1': '已锁定',
        false: '可编辑',
        true: '已锁定'
    },
    'customers.industry': {
        'entity': '实业',
        'finance': '金融',
        'internet': '互联网',
        'services': '服务',
        'trade': '贸易'
    }
};

const bills_enum_mapping = {
    'bills.type': {
        'monthly': '月度账单',
        'initial': '首期账单'
    },
    'bills.status': {
        'unpaid': '未支付',
        'paid': '已支付',
        'overdue': '已逾期',
        'cancelled': '已作废'
    }
}

const contracts_enum_mapping = {
    'contracts.payment_cycle': {
        'monthly': '月付',
        'quarterly': '季付',
        'yearly': '年付',
        'one_time': '一次性付款'
    },
    'contract.status': {
        'active': '生效中',
        'terminated': '已终止',
        'expired': '已过期',
        'draft': '草稿',
        'approve_pending': '审核中',
        'rejected': '已驳回'
    }
}

const allEnumMappings = {
    ...units_enum_mapping,
    ...customer_enum_mapping,
    ...bills_enum_mapping,
    ...contracts_enum_mapping
};

function applyEnumMappings(rows, mainTableName = null, aliasMap = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;

    return rows.map(row => {
        const newRow = { ...row };

        Object.keys(newRow).forEach(fieldAlias => {
            let value = newRow[fieldAlias];

            if (value === null || value === undefined) return;

            // ----------- ★ 新增：统计值保护逻辑 ★ -----------
            // 数字类型，不处理
            if (typeof value === 'number') return;

            const strValue = String(value);

            // 纯数字字符串，不处理（避免误把 "0" 映射成枚举）
            if (/^\d+$/.test(strValue)) return;
            // -------------------------------------------------

            // 1) 优先用 aliasMap（"客户状态" -> "customers.status"）
            const origField = aliasMap[fieldAlias];

            if (origField) {
                const mapping = allEnumMappings[origField];
                if (mapping && mapping[strValue] !== undefined) {
                    newRow[fieldAlias] = mapping[strValue];
                    return;
                }
            }

            // 2) mainTableName + lastSegment
            const lastSegment = (() => {
                if (origField) {
                    const parts = origField.split('.');
                    return parts[parts.length - 1];
                }
                if (typeof fieldAlias === 'string' && /^[a-zA-Z0-9_]+$/.test(fieldAlias)) {
                    return fieldAlias;
                }
                return null;
            })();

            if (mainTableName && lastSegment) {
                const tableFieldKey = `${mainTableName}.${lastSegment}`;
                const mapping = allEnumMappings[tableFieldKey];
                if (mapping && mapping[strValue] !== undefined) {
                    newRow[fieldAlias] = mapping[strValue];
                    return;
                }
            }

            // 3) lastSegment 单字段名（如 expected_move_in）
            if (lastSegment) {
                const mapping = allEnumMappings[lastSegment];
                if (mapping && mapping[strValue] !== undefined) {
                    newRow[fieldAlias] = mapping[strValue];
                    return;
                }
            }

            // 4) 最后用 value 匹配枚举
            for (const key of Object.keys(allEnumMappings)) {
                const mapping = allEnumMappings[key];
                if (mapping && mapping[strValue] !== undefined) {
                    newRow[fieldAlias] = mapping[strValue];
                    return;
                }
            }
        });

        return newRow;
    });
}

module.exports = {
    applyEnumMappings,
    allEnumMappings
};
