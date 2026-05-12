/**
 * 字段类型映射表
 * key: 小写表名
 * value: 对应字段及类型
 * 支持类型：
 *   - "string"   文本/字符
 *   - "number"   数字
 *   - "date"     日期
 *   - "select"   枚举/下拉
 * 如果某字段未在映射中定义，默认使用 "string"
 */

const fieldTypeMap = {
    contracts: {
        sign_date: "date",
        start_date: "date",
        end_date: "date",
        deposit_amount: "number",
        payment_cycle: "string",
        status: "select",
        lessor_id: "string",
        tenant_id: "string"
    },
    contract_units: {
        lease_area: "number",
        rent_unit_price: "number",
        deal_unit_price: "number",
        deal_total_price: "number",
        rent_mode: "select",
        remarks: "string"
    },
    bills: {
        start_date: "date",
        end_date: "date",
        rent: "number",
        service_fee: "number",
        total: "number",
        status: "select",
        created_at: "date",
        updated_at: "date"
    },
    customers: {
        customer_name: "string",
        contact_phone: "string",
        expected_move_in: "string",
        rental_mode: "string",
        industry: "string",
        status: "string",
        acquired_at:"date",
        created_at: "date",
        updated_at: "date"
    }
};

/**
 * 安全获取字段类型
 * @param {string} table 表名
 * @param {string} field 字段名
 * @returns {string} 字段类型，如果没有映射则默认 "string"
 */
function getFieldType(table, field) {
    if (!table || !field) return "string";
    const tableKey = table.toLowerCase();
    return fieldTypeMap[tableKey]?.[field] || "string";
}

module.exports = { fieldTypeMap, getFieldType };
