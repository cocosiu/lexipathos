const resourceDictionary = {
    // ─── 合同 ───
    contracts: {
      label: "合同",
      alias: "c",
      description: "租赁合同信息",
      defaultFields: ["id", "contract_number", "tenant_id", "start_date", "end_date", "deposit_amount", "payment_cycle", "status", "sign_date"],
      fields: {
        id:                 { label: "合同ID",       description: "系统自动生成的合同唯一标识" },
        contract_number:    { label: "合同编号",     description: "业务编号" },
        tenant_id:          { label: "租户ID",       description: "合同对应的租户" },
        start_date:         { label: "起租日期",     description: "合同起始日期" },
        end_date:           { label: "终止日期",     description: "合同结束日期" },
        deposit_amount:     { label: "押金金额",     description: "合同押金" },
        payment_cycle:      { label: "付款周期",     description: "付款频率（月/季/年）" },
        status:             { label: "合同状态",     description: "合同状态" },
        sign_date:          { label: "签约日期",     description: "签约日期" },
      },
      relations: [
        { name: "tenant",           type: "tenants",         relation_type: "belongs_to",  on: "contracts.tenant_id = tenants.id" },
        { name: "contract_units",   type: "contract_units",  relation_type: "has_many",    on: "contract_units.contract_id = contracts.id" },
        { name: "terms",            type: "contract_terms",  relation_type: "has_many",    on: "contract_terms.contract_id = contracts.id" },
        { name: "bills",            type: "bills",           relation_type: "has_many",    on: "bills.contract_id = contracts.id" },
      ]
    },
  
    // ─── 签约单元 ───
    contract_units: {
      label: "单元签约记录",
      alias: "cu",
      description: "单元签约记录，连接合同和单元的桥梁表",
      defaultFields: ["id", "contract_id", "unit_id", "deal_unit_price", "deal_management_fee_per_sqm", "deal_total_price", "lease_area"],
      fields: {
        id:                           { label: "签约记录ID",         description: "唯一标识" },
        contract_id:                  { label: "关联的合同ID",       description: "关联的合同ID" },
        unit_id:                      { label: "关联的单元ID",       description: "关联的单元ID" },
        deal_unit_price:              { label: "成交单价",           description: "成交单价" },
        deal_management_fee_per_sqm:  { label: "成交管理费单价",     description: "成交管理费单价" },
        deal_total_price:             { label: "成交总价",           description: "成交总价" },
        lease_area:                   { label: "签约面积",           description: "签约面积" },
      },
      relations: [
        { name: "contract", type: "contracts", relation_type: "belongs_to", on: "contract_units.contract_id = contracts.id" },
        { name: "unit",     type: "units",     relation_type: "belongs_to", on: "contract_units.unit_id = units.id" },
      ]
    },
  
    // ─── 账期 ───
    contract_terms: {
      label: "合同账期",
      alias: "ct",
      description: "合同账期",
      defaultFields: ["id", "contract_id", "deal_unit_price", "total_rent", "service_rate", "total_service_fee", "month_equivalent", "average_monthly_service_fee", "average_monthly_rent"],
      fields: {
        id:                         { label: "账期ID",             description: "唯一标识" },
        contract_id:                { label: "关联合同id",         description: "关联合同id" },
        deal_unit_price:            { label: "当前租金单价",       description: "当前租金单价" },
        total_rent:                 { label: "当前月租金总价",     description: "当前月租金总价" },
        service_rate:               { label: "管理费单价",         description: "管理费单价" },
        total_service_fee:          { label: "月管理费总价",       description: "月管理费总价" },
        month_equivalent:           { label: "账期月当量",         description: "账期月当量" },
        average_monthly_service_fee:{ label: "月管理费",           description: "月管理费" },
        average_monthly_rent:       { label: "月租金",             description: "月租金" },
      },
      relations: [
        { name: "contract", type: "contracts", relation_type: "belongs_to", on: "contract_terms.contract_id = contracts.id" },
      ]
    },
  
    // ─── 账单 ───
    bills: {
      label: "账单",
      alias: "b",
      description: "账单",
      defaultFields: ["bill_number", "status", "contract_id", "term_id", "start_date", "end_date", "rent", "service_fee", "total"],
      fields: {
        bill_number:  { label: "账单号",             description: "唯一标识" },
        status:       { label: "账单状态",           description: "账单状态" },
        contract_id:  { label: "账单对应的合同编号",  description: "账单对应的合同编号" },
        term_id:      { label: "账期编号",           description: "账期编号" },
        start_date:   { label: "账单开始日期",        description: "账单开始日期" },
        end_date:     { label: "账单截止日期",        description: "账单截止日期" },
        rent:         { label: "租金",               description: "租金" },
        service_fee:  { label: "管理费",             description: "管理费" },
        total:        { label: "总计",               description: "租金+管理费合计" },
      },
      relations: [
        { name: "contract", type: "contracts", relation_type: "belongs_to", on: "bills.contract_id = contracts.id" },
      ]
    },
  
    // ─── 单元 ───
    units: {
      label: "单元",
      alias: "u",
      description: "单元信息",
      defaultFields: ["id", "building_id", "floor", "code", "status", "lease_area", "usable_area", "build_area", "management_fee_per_sqm", "is_deleted", "rent_unit_price"],
      fields: {
        id:                       { label: "单元ID",           description: "系统自动生成的合同唯一标识" },
        building_id:              { label: "项目ID",           description: "单元所属的项目" },
        floor:                    { label: "楼层",             description: "单元所在楼层" },
        code:                     { label: "单元编号",         description: "单元编号" },
        status:                   { label: "单元状态",         description: "单元状态（vancant/leased/reserved）" },
        lease_area:               { label: "出租面积",         description: "合同计租面积" },
        usable_area:              { label: "套内面积",         description: "套内面积" },
        build_area:               { label: "建筑面积",         description: "建筑面积" },
        management_fee_per_sqm:   { label: "管理费单价",       description: "管理费单价" },
        rent_unit_price:          { label: "挂牌租金单价",     description: "挂牌租金单价" },
        is_deleted:               { label: "是否作废",         description: "软删除标识" },
        vacant_since:             { label: "空置起始日",       description: "空置起始日" }
      },
      relations: [
        { name: "building",         type: "buildings",                   relation_type: "belongs_to",  on: "units.building_id = buildings.id" },
        { name: "contract_units",   type: "contract_units",              relation_type: "has_many",    on: "contract_units.unit_id = units.id" },
        { name: "visited_records",  type: "crm_customer_visited_units",  relation_type: "has_many",    on: "crm_customer_visited_units.unit_id = units.id" },
      ]
    },
  
    // ─── 项目 ───
    buildings: {
      label: "项目",
      alias: "bd",
      description: "项目",
      defaultFields: ["id", "name", "city"],
      fields: {
        id:     { label: "项目ID",   description: "项目唯一标识" },
        name:   { label: "项目名称", description: "项目名称" },
        city:   { label: "城市",     description: "项目所在城市" },
      },
      relations: [
        { name: "units", type: "units", relation_type: "has_many", on: "units.building_id = buildings.id" },
      ]
    },
  
    // ─── 租户 ───
    tenants: {
      label: "租户",
      alias: "t",
      description: "租户基本信息",
      defaultFields: ["id", "name"],
      fields: {
        id:   { label: "租户ID",     description: "租户唯一标识" },
        name: { label: "租户名称",   description: "租户公司或个人名称" },
      },
      relations: []
    },
  
    // ─── 客户 ───
    customers: {
      label: "客户",
      alias: "cu",
      description: "客户基本信息",
      defaultFields: ["id", "customer_name", "contact_person", "gender", "customer_source", "acquired_at", "status", "site_selection_progress", "expected_move_in", "follow_up_stage", "industry", "use_reason", "created_at", "created_by"],
      fields: {
        id:                      { label: "客户ID",         description: "客户唯一标识" },
        customer_name:           { label: "客户名称",       description: "客户公司或个人名称" },
        contact_person:          { label: "联系人",         description: "来访人员名称" },
        gender:                  { label: "性别",           description: "来访人员性别" },
        customer_source:         { label: "客户来源",       description: "中介/网客..." },
        acquired_at:             { label: "获客时间",       description: "获客时间" },
        created_at:              { label: "录入时间",       description: "录入时间" },
        created_by:              { label: "创建人ID",       description: "创建人ID，废弃字段请用 owner_id" },
        owner_id:                { label: "负责人ID",       description: "所属销售/招商负责人" },
        status:                  { label: "客户状态",       description: "客户状态" },
        site_selection_progress: { label: "选址阶段",       description: "海选/锁定/对比等" },
        expected_move_in:        { label: "最迟使用时间",   description: "最迟使用时间" },
        follow_up_stage:         { label: "跟进阶段",       description: "跟进阶段" },
        industry:                { label: "行业",           description: "客户所属行业" },
        use_reason:              { label: "使用原因",       description: "场地使用原因" },
      },
      relations: [
        { name: "owner",              type: "sales_channels",                 relation_type: "belongs_to",  on: "sales_channels.id = customers.owner_id" },
        { name: "visited_units",      type: "crm_customer_visited_units",     relation_type: "has_many",    on: "crm_customer_visited_units.customer_id = customers.id" },
        { name: "agents",             type: "crm_customer_agents",            relation_type: "has_many",    on: "crm_customer_agents.customer_id = customers.id" },
        { name: "whole_rent_demands", type: "crm_customer_whole_rent_demands",relation_type: "has_many",    on: "crm_customer_whole_rent_demands.customer_id = customers.id" },
      ]
    },
  
    // ─── 销售人员 ───
    sales_channels: {
      label: "用户",
      alias: "sc",
      description: "用户/销售人员基本信息",
      defaultFields: ["id", "name"],
      fields: {
        id:   { label: "用户ID",   description: "用户唯一标识" },
        name: { label: "用户名称", description: "用户名称" },
      },
      relations: []
    },
  
    // ─── 看房记录 ───
    crm_customer_visited_units: {
      label: "客户看房记录",
      alias: "ccvu",
      description: "客户看房记录",
      defaultFields: ["id", "customer_id", "unit_id"],
      fields: {
        id:          { label: "看房记录ID",   description: "唯一标识" },
        customer_id: { label: "关联的客户ID", description: "关联的客户ID" },
        unit_id:     { label: "关联的单元ID", description: "关联的单元ID" },
      },
      relations: [
        { name: "customer", type: "customers", relation_type: "belongs_to", on: "crm_customer_visited_units.customer_id = customers.id" },
        { name: "unit",     type: "units",     relation_type: "belongs_to", on: "crm_customer_visited_units.unit_id = units.id" },
      ]
    },
  
    // ─── 中介来访 ───
    crm_customer_agents: {
      label: "中介来访记录",
      alias: "cca",
      description: "中介来访记录",
      defaultFields: ["id", "customer_id", "agent_company", "contact_person", "exposure_channel", "lead_source"],
      fields: {
        id:              { label: "来访记录id",     description: "唯一标识" },
        customer_id:     { label: "关联的客户ID",   description: "关联的客户ID" },
        agent_company:   { label: "中介公司",       description: "中介公司" },
        contact_person:  { label: "中介联系人",     description: "中介联系人" },
        exposure_channel:{ label: "曝光方式",        description: "如何对中介进行曝光？" },
        lead_source:     { label: "中介获客渠道",   description: "中介获客渠道" },
      },
      relations: [
        { name: "customer", type: "customers", relation_type: "belongs_to", on: "crm_customer_agents.customer_id = customers.id" },
      ]
    },
  
    // ─── 整租需求 ───
    crm_customer_whole_rent_demands: {
      label: "客户需求信息（整租）",
      alias: "ccwrd",
      description: "客户需求信息（整租）",
      defaultFields: ["id", "customer_id", "intended_area_min", "intended_area_max", "total_budget", "unit_price_budget", "total_budget_includes_service_fee", "unit_price_budget_includes_service_fee"],
      fields: {
        id:                                   { label: "需求ID",                     description: "唯一标识" },
        customer_id:                          { label: "关联的客户ID",               description: "关联的客户ID" },
        intended_area_min:                    { label: "最小需求面积",               description: "最小需求面积" },
        intended_area_max:                    { label: "最大需求面积",               description: "最大需求面积" },
        total_budget:                         { label: "总价预算",                   description: "总价预算" },
        unit_price_budget:                    { label: "单价预算",                   description: "单价预算" },
        total_budget_includes_service_fee:    { label: "总价是否含管理费",           description: "总价是否含管理费" },
        unit_price_budget_includes_service_fee:{ label: "单价是否含管理费",          description: "单价是否含管理费" },
      },
      relations: [
        { name: "customer", type: "customers", relation_type: "belongs_to", on: "crm_customer_whole_rent_demands.customer_id = customers.id" },
      ]
    },
  };
  
  module.exports = { resourceDictionary };
  