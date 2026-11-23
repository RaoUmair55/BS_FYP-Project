const jwt = require('jsonwebtoken');
const Session = require('../models/Session');

function signSessionToken(sessionId, scope = 'candidate_session', extra = {}) {
    if (!process.env.SESSION_TOKEN_SECRET || process.env.SESSION_TOKEN_SECRET.length < 32) {
        throw new Error('Configure SESSION_TOKEN_SECRET with at least 32 random characters');
    }
    return jwt.sign({ ...extra, sessionId: String(sessionId), scope }, process.env.SESSION_TOKEN_SECRET,
        { algorithm: 'HS256', expiresIn: scope === 'secondary_camera' ? '4h' : '24h' });
}

function verifySessionToken(token) {
    if (!process.env.SESSION_TOKEN_SECRET) throw new Error('Session authentication unavailable');
    return jwt.verify(token, process.env.SESSION_TOKEN_SECRET, { algorithms: ['HS256'] });
}

async function authenticate(token, scope, requestedSessionId) {
    const decoded = verifySessionToken(token);
    if (decoded.scope !== scope || !/^[a-f0-9]{24}$/i.test(decoded.sessionId || '') ||
        (requestedSessionId && String(requestedSessionId) !== decoded.sessionId)) throw new Error('Wrong session or scope');
    const session = await Session.findById(decoded.sessionId);
    if (!session || session.status !== 'active') throw new Error('Session is not active');
    if (scope === 'secondary_camera' && (!decoded.jti || session.secondaryCamera?.credentialId !== decoded.jti)) {
        throw new Error('Phone credential was replaced');
    }
    return { decoded, session };
}

function scopedAuth(scope) {
    return async (req, res, next) => {
        try {
            const requested = req.params.sessionId || req.body?.sessionId || req.query.sessionId;
            const result = await authenticate(req.headers.authorization?.replace(/^Bearer /, ''), scope, requested);
            req.candidateSession = result.session;
            req.sessionClaims = result.decoded;
            next();
        } catch { res.status(401).json({ error: 'Invalid, expired or mismatched session credential' }); }
    };
}

module.exports = { signSessionToken, verifySessionToken, authenticate,
    requireSessionAuth: scopedAuth('candidate_session'), requireSideCameraAuth: scopedAuth('secondary_camera') };
