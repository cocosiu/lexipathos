const { createClient } = require('redis');

const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

/**
 * 检查用户权限
 * @param {string} permissionCode - 权限标识
 */
function checkPermissionMiddleware(permissionCode) {
    return async (req, res, next) => {
        try {
            const userId = req.body.user_id || req.query.user_id;
            if (!userId) {
                return res.status(400).json({ success: false, message: '缺少 user_id' });
            }

            const raw = await redisClient.get(`user_permissions:${userId}`);
            if (!raw) return res.status(403).json({ success: false, message: '未找到用户权限' });

            const permissions = JSON.parse(raw);
            const perm = permissions[permissionCode];

            if (!perm) {
                return res.status(403).json({ success: false, message: '没有访问该接口的权限' });
            }

            // 保存权限信息到请求对象
            req.permissionConstraint = perm.constraints || {};
            req.permissionScope = perm.scope || 'all';
            req.permissionType = perm.type || '';
            req.user = { id: userId };

            next();
        } catch (err) {
            console.error('权限校验失败', err);
            res.status(500).json({ success: false, message: '权限校验异常' });
        }
    };
}

module.exports = { checkPermissionMiddleware, redisClient };
