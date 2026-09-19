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
        role: teacher.role || 'teacher'
    };

    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_fallback_key_32bytes!!';
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
 * Verify a JWT access token
 * @param {string} token - JWT token string
 * @returns {Object} Decoded payload
 */
function verifyAccessToken(token) {
    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_fallback_key_32bytes!!';
    return jwt.verify(token, secret);
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    hashToken,
    verifyAccessToken
};
