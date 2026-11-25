const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const Teacher = require('../models/Teacher');
const { verifyAccessToken } = require('../utils/tokens');
const requireEmailVerification = require('../utils/emailVerification');
const { ownsExam } = require('./examAccess');

function extractBearerToken(req) {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
}

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

async function authenticate(token, scope, requestedSessionId, { allowInactive = false } = {}) {
    const decoded = verifySessionToken(token);
    if (decoded.scope !== scope || !/^[a-f0-9]{24}$/i.test(decoded.sessionId || '') ||
        (requestedSessionId && String(requestedSessionId) !== decoded.sessionId)) {
        throw new Error('Wrong session or scope');
    }
    const session = await Session.findById(decoded.sessionId);
    if (!session) throw new Error('Session not found');
    if (!allowInactive && session.status !== 'active') throw new Error('Session is not active');
    if (scope === 'secondary_camera' && (!decoded.jti || session.secondaryCamera?.credentialId !== decoded.jti)) {
        throw new Error('Phone credential was replaced');
    }
    return { decoded, session };
}

function scopedAuth(scope, { allowInactive = false } = {}) {
    return async (req, res, next) => {
        try {
            const token = extractBearerToken(req);
            if (!token) return res.status(401).json({ error: 'Invalid, expired or mismatched session credential' });
            const requested = req.params.sessionId || req.body?.sessionId || req.query.sessionId;
            const result = await authenticate(token, scope, requested, { allowInactive });
            req.candidateSession = result.session;
            req.sessionClaims = result.decoded;
            req.authActor = scope === 'secondary_camera' ? 'side_camera' : 'candidate';
            next();
        } catch {
            res.status(401).json({ error: 'Invalid, expired or mismatched session credential' });
        }
    };
}

/**
 * Authenticates POST /violation before multer runs.
 * Accepts either a candidate_session JWT (active or ended, so offline late evidence can flush)
 * or an active secondary_camera JWT (with matching credentialId).
 */
async function requireViolationAuth(req, res, next) {
    try {
        const token = extractBearerToken(req);
        if (!token) return res.status(401).json({ error: 'Session authentication required' });
        const decoded = verifySessionToken(token);
        if (decoded.scope === 'secondary_camera') {
            const result = await authenticate(token, 'secondary_camera', null, { allowInactive: false });
            req.candidateSession = result.session;
            req.sessionClaims = result.decoded;
            req.authActor = 'side_camera';
            return next();
        }
        if (decoded.scope === 'candidate_session') {
            const result = await authenticate(token, 'candidate_session', null, { allowInactive: true });
            req.candidateSession = result.session;
            req.sessionClaims = result.decoded;
            req.authActor = 'candidate';
            return next();
        }
        return res.status(401).json({ error: 'Invalid session credential scope' });
    } catch {
        return res.status(401).json({ error: 'Invalid, expired or mismatched session credential' });
    }
}

/**
 * Allows either the candidate owning :sessionId (Bearer candidate_session JWT)
 * OR the authenticated teacher/admin owning that session's exam (Bearer teacher access JWT).
 */
function requireSessionOrOwnedTeacher({ allowInactive = true } = {}) {
    return async (req, res, next) => {
        const token = extractBearerToken(req);
        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        const requestedSessionId = req.params.sessionId;

        // 1. Try candidate_session JWT first (signed with SESSION_TOKEN_SECRET)
        try {
            const result = await authenticate(token, 'candidate_session', requestedSessionId, { allowInactive });
            req.candidateSession = result.session;
            req.sessionClaims = result.decoded;
            req.authActor = 'candidate';
            return next();
        } catch {
            // Fall through to teacher JWT check
        }

        // 2. Try teacher/admin access JWT (signed with JWT_SECRET)
        let decoded;
        try {
            decoded = verifyAccessToken(token);
        } catch {
            return res.status(401).json({ error: 'Invalid, expired or mismatched credential' });
        }

        try {
            const teacher = await Teacher.findById(decoded.teacherId);
            if (!teacher) return res.status(401).json({ error: 'Account no longer exists' });
            if (requireEmailVerification.needsVerification(teacher)) {
                return res.status(403).json({ error: 'Email verification required', code: 'EMAIL_VERIFICATION_REQUIRED' });
            }
            req.teacher = {
                teacherId: teacher._id.toString(),
                email: teacher.email,
                role: teacher.role
            };
            if (!/^[a-f0-9]{24}$/i.test(String(requestedSessionId || ''))) {
                return res.status(404).json({ error: 'Session not found' });
            }
            const session = await Session.findById(requestedSessionId);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            if (!await ownsExam(req, session.examId)) {
                return res.status(403).json({ error: 'Forbidden: You do not own this session' });
            }
            req.candidateSession = session;
            req.authActor = 'teacher';
            return next();
        } catch (err) {
            console.error('requireSessionOrOwnedTeacher error:', err);
            return res.status(500).json({ error: 'Authentication check failed' });
        }
    };
}

module.exports = {
    extractBearerToken,
    signSessionToken,
    verifySessionToken,
    authenticate,
    requireSessionAuth: scopedAuth('candidate_session'),
    requireSessionAuthAllowEnded: scopedAuth('candidate_session', { allowInactive: true }),
    requireSideCameraAuth: scopedAuth('secondary_camera'),
    requireViolationAuth,
    requireSessionOrOwnedTeacher
};
