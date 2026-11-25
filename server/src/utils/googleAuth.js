const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function parseMaxAgeSeconds(cacheControl) {
    if (typeof cacheControl !== 'string') return 3600;
    const match = /max-age=(\d+)/i.exec(cacheControl);
    if (!match) return 3600;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 60 ? seconds : 3600;
}

async function fetchGoogleJwks(forceRefresh = false, fetchImpl = fetch) {
    if (!forceRefresh && cachedJwks && Date.now() < cachedJwksExpiresAt) {
        return cachedJwks;
    }
    const res = await fetchImpl(GOOGLE_JWKS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch Google signing keys (HTTP ${res.status})`);
    }
    const body = await res.json();
    if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
        throw new Error('Google signing keys response was empty');
    }
    const maxAgeSec = parseMaxAgeSeconds(res.headers.get('cache-control'));
    cachedJwks = body.keys;
    cachedJwksExpiresAt = Date.now() + maxAgeSec * 1000;
    return cachedJwks;
}

function clearGoogleJwksCache() {
    cachedJwks = null;
    cachedJwksExpiresAt = 0;
}

/**
 * Cryptographically verifies a Google Identity Services ID token (RS256)
 * against Google's JWKS keys, checking algorithm, signature, expiration,
 * issuer, and audience.
 */
async function verifyGoogleIdToken(idToken, expectedClientId, { jwksFetcher = fetchGoogleJwks } = {}) {
    if (typeof idToken !== 'string' || !idToken.trim()) {
        const err = new Error('Google ID token is required');
        err.statusCode = 400;
        throw err;
    }
    if (typeof expectedClientId !== 'string' || !expectedClientId.trim()) {
        const err = new Error('Google Sign-In is not configured on the server');
        err.statusCode = 503;
        throw err;
    }

    const decodedComplete = jwt.decode(idToken, { complete: true });
    if (!decodedComplete || !decodedComplete.header || !decodedComplete.payload) {
        const err = new Error('Malformed Google ID token');
        err.statusCode = 401;
        throw err;
    }

    const { alg, kid } = decodedComplete.header;
    if (alg !== 'RS256' || typeof kid !== 'string' || !kid) {
        const err = new Error('Unsupported or unsigned Google ID token');
        err.statusCode = 401;
        throw err;
    }

    let keys = await jwksFetcher(false);
    let jwk = keys.find(k => k.kid === kid && k.kty === 'RSA');
    if (!jwk) {
        // Key may have rotated recently — refresh JWKS once
        keys = await jwksFetcher(true);
        jwk = keys.find(k => k.kid === kid && k.kty === 'RSA');
    }
    if (!jwk) {
        const err = new Error('Unknown Google signing key');
        err.statusCode = 401;
        throw err;
    }

    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    let payload;
    try {
        payload = jwt.verify(idToken, publicKey, {
            algorithms: ['RS256'],
            audience: expectedClientId.trim(),
            issuer: VALID_ISSUERS
        });
    } catch (verifyErr) {
        const err = new Error('Invalid or expired Google ID token');
        err.statusCode = 401;
        err.cause = verifyErr;
        throw err;
    }

    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const picture = typeof payload.picture === 'string' && /^https:\/\//i.test(payload.picture) ? payload.picture : null;

    if (!sub || !email) {
        const err = new Error('Google ID token is missing required identity claims');
        err.statusCode = 401;
        throw err;
    }

    return {
        sub,
        email,
        emailVerified,
        name: rawName,
        picture
    };
}

module.exports = {
    verifyGoogleIdToken,
    fetchGoogleJwks,
    clearGoogleJwksCache
};
