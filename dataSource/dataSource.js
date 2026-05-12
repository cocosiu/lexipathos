module.exports = [
    {
        name: 'contracts',
        mysqlTable: 'contracts',
        duckTable: 'contracts',
        keyField: 'id',
        updatedField: 'updated_at',
        loadSql: (lastUpdated) => {
            if (lastUpdated) {
                return `SELECT * FROM contracts WHERE updated_at > '${lastUpdated.toISOString()}'`;
            } else {
                return 'SELECT * FROM contracts';
            }
        }
    },
    {
        name: 'bills',
        mysqlTable: 'bills',
        duckTable: 'bills',
        keyField: 'id',
        updatedField: 'updated_at',
        loadSql: (lastUpdated) => {
            if (lastUpdated) {
                return `SELECT * FROM bills WHERE updated_at > '${lastUpdated.toISOString()}'`;
            } else {
                return 'SELECT * FROM bills';
            }
        }
    },
    {
        name: 'customers',
        mysqlTable: 'crm_customers',
        duckTable: 'customers',
        keyField: 'id',
        updatedField: 'updated_at',
        loadSql: (lastUpdated) => {
            if (lastUpdated) {
                return `SELECT * FROM crm_customers WHERE updated_at > '${lastUpdated.toISOString()}'`;
            } else {
                return 'SELECT * FROM crm_customers';
            }
        }
    },
    {
        name: 'units',
        mysqlTable: 'units',
        duckTable: 'units',
        keyField: 'id',
        updatedField: 'updated_at',
        loadSql: (lastUpdated) => {
            if (lastUpdated) {
                return `SELECT * FROM units WHERE updated_at > '${lastUpdated.toISOString()}'`;
            } else {
                return 'SELECT * FROM units';
            }
        }
    },
    {
        name: 'customer_visited_units',
        mysqlTable: 'crm_customer_visited_units',
        duckTable: 'crm_customer_visited_units',
        keyField: 'id',
        createdField: 'created_at',
        loadSql: () => {
            return 'SELECT * FROM crm_customer_visited_units';
        }
    },
    {
        name: 'contract_units',
        mysqlTable: 'contract_units',
        duckTable: 'contract_units',
        keyField: 'id',
        updatedField: 'updated_at',
        loadSql: () => {
            return 'SELECT * FROM contract_units where deleted_at IS NULL';
        }
    },
    {
        name: 'contract_terms',
        mysqlTable: 'contract_terms',
        duckTable: 'contract_terms',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM contract_terms';
        }
    },
    {
        name: 'buildings',
        mysqlTable: 'buildings',
        duckTable: 'buildings',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM buildings';
        }
    },
    {
        name: 'sales_channel',
        mysqlTable: 'sales_channels',
        duckTable: 'sales_channels',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM sales_channels';
        }
    },
    {
        name: 'crm_customer_agents',
        mysqlTable: 'crm_customer_agents',
        duckTable: 'crm_customer_agents',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM crm_customer_agents';
        }
    },
    {
        name: 'crm_customer_agents',
        mysqlTable: 'crm_customer_agents',
        duckTable: 'crm_customer_agents',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM crm_customer_agents';
        }
    },
    {
        name: 'crm_customer_whole_rent_demands',
        mysqlTable: 'crm_customer_whole_rent_demands',
        duckTable: 'crm_customer_whole_rent_demands',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM crm_customer_whole_rent_demands';
        }
    },
    {
        name: 'tenants',
        mysqlTable: 'tenants',
        duckTable: 'tenants',
        keyField: 'id',
        loadSql: () => {
            return 'SELECT * FROM tenants';
        }
    }
];
