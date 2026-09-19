const { verifyAccessToken } = require('../utils/tokens');
const Teacher = require('../models/Teacher');

/**
 * Middleware to require and verify JWT Bearer access token
 */
async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'Authentication required. Token is missing.' });
        }

        let decoded;
        try {
            decoded = verifyAccessToken(token);
        } catch (jwtErr) {
            if (jwtErr.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
            }
            return res.status(401).json({ error: 'Invalid access token', code: 'INVALID_TOKEN' });
        }

        // Attach decoded info to request
        req.teacher = {
            teacherId: decoded.teacherId,
            email: decoded.email,
            role: decoded.role
        };

        next();
    } catch (err) {
        console.error('requireAuth error:', err);
        return res.status(500).json({ error: 'Authentication failed' });
    }
}

/**
 * Middleware factory to enforce specific roles (e.g., 'admin', 'teacher')
 * Must be used after requireAuth
 * @param  {...string} roles Allowed roles
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.teacher) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.teacher.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
        }

        next();
    };
}

module.exports = {
    requireAuth,
    requireRole
};
