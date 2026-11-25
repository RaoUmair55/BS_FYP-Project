const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Generate a JWT access token for a teacher (15-minute expiration)
 * @param {Object} teacher - Teacher document or object containing _id, email, role
 * @returns {string} Signed JWT access token
 */
function generateAccessToken(teacher) {
    const payload = {
        teacherId: teacher._id ? teacher._id.toString() : teacher.teacherId,
        email: teacher.email,
        role: teacher.role || 'teacher',
        scope: 'teacher_access'
    };

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    return jwt.sign(payload, secret, { expiresIn: '15m' });
}

/**
 * Generate a read-only media token strictly scoped for /uploads asset URLs.
 * Cannot be used to call authenticated teacher/admin API endpoints.
 * @param {Object} teacher - Teacher document or object containing _id, role
 * @returns {string} Signed media-scoped JWT
 */
function generateMediaToken(teacher) {
    const payload = {
        teacherId: teacher._id ? teacher._id.toString() : teacher.teacherId,
        role: teacher.role || 'teacher',
        scope: 'media_read'
    };

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    return jwt.sign(payload, secret, { expiresIn: '15m' });
}

/**
 * Compute SHA-256 hash of a raw token string
 * @param {string} token - Raw token string
 * @returns {string} Hex encoded SHA-256 hash
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a secure random refresh token and its SHA-256 hash
 * @returns {{ token: string, tokenHash: string }} Raw token and DB-safe hash
 */
function generateRefreshToken() {
    const token = crypto.randomBytes(40).toString('hex');
    const tokenHash = hashToken(token);
    return { token, tokenHash };
}

/**
 * Verify a teacher API JWT access token (rejects media_read tokens)
 * @param {string} token - JWT token string
 * @returns {Object} Decoded payload
 */
function verifyAccessToken(token) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const decoded = jwt.verify(token, secret);
    if (decoded.scope && decoded.scope !== 'teacher_access') {
        const err = new Error('Invalid token scope');
        err.name = 'JsonWebTokenError';
        throw err;
    }
    return decoded;
}

/**
 * Verify a read-only media JWT token (strictly requires scope === 'media_read')
 * @param {string} token - JWT token string
 * @returns {Object} Decoded payload
 */
function verifyMediaToken(token) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const decoded = jwt.verify(token, secret);
    if (decoded.scope !== 'media_read') {
        const err = new Error('Media-scoped token required');
        err.name = 'JsonWebTokenError';
        throw err;
    }
    return decoded;
}

module.exports = {
    generateAccessToken,
    generateMediaToken,
    generateRefreshToken,
    hashToken,
    verifyAccessToken,
    verifyMediaToken
};
