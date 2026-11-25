// Run with: npm --prefix server run check:google-auth
// Verifies RS256 Google ID token cryptographic verification, safe account linking
// (no duplicates, preserves roles), unverified email rejection, hijack prevention,
// and Google-only password-login guard.
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.JWT_SECRET = 'google-auth-check-jwt-secret-32-chars!';
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';

const Teacher = require('../src/models/Teacher');
const RefreshToken = require('../src/models/RefreshToken');
const AuthAuditLog = require('../src/models/AuthAuditLog');
const { verifyGoogleIdToken, clearGoogleJwksCache } = require('../src/utils/googleAuth');

// Generate an ephemeral RS256 keypair and JWK for genuine cryptographic verification
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'google-test-kid-1', alg: 'RS256', use: 'sig' };

const teachers = [];
const auditLogs = [];

Teacher.findOne = async (query) => {
    return teachers.find(t => {
        if (query.googleId) return t.googleId === query.googleId;
        if (query.email) return t.email === query.email;
        return false;
    }) || null;
};
Teacher.prototype.save = async function () {
    const idx = teachers.findIndex(t => String(t._id) === String(this._id));
    if (idx >= 0) teachers[idx] = this;
    else teachers.push(this);
    return this;
};
RefreshToken.create = async (doc) => doc;
AuthAuditLog.create = async (doc) => { auditLogs.push(doc); return doc; };

const app = express();
app.use(express.json());
app.use(cookieParser());
app.locals.verifyGoogleIdToken = (token, clientId) =>
    verifyGoogleIdToken(token, clientId, { jwksFetcher: async () => [publicJwk] });
app.use('/auth', require('../src/routes/auth'));

function signGoogleJwt(claims, { kid = 'google-test-kid-1', alg = 'RS256', key = privateKey } = {}) {
    return jwt.sign(
        {
            iss: 'https://accounts.google.com',
            aud: CLIENT_ID,
            sub: 'google-sub-1001',
            email: 'new.examiner@university.edu',
            email_verified: true,
            name: 'Dr. Ada Lovelace',
            picture: 'https://lh3.googleusercontent.com/a/example',
            ...claims
        },
        key,
        { algorithm: alg, keyid: kid, expiresIn: '10m' }
    );
}

let server;
let base;

async function post(pathUrl, body) {
    const res = await fetch(`${base}${pathUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
}

async function main() {
    clearGoogleJwksCache();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    // 1. Provider discovery advertises Google Sign-In when configured
    const providers = await (await fetch(`${base}/auth/providers`)).json();
    assert.equal(providers.googleEnabled, true);
    assert.equal(providers.googleClientId, CLIENT_ID);
    console.log('PASS: GET /auth/providers advertises configured Google client ID');

    // 2. Reject invalid, wrong-audience, wrong-issuer, HS256-forged, and unverified-email tokens
    assert.equal((await post('/auth/google', {})).status, 400);
    assert.equal((await post('/auth/google', { credential: 'not-a-jwt' })).status, 401);
    assert.equal((await post('/auth/google', { credential: signGoogleJwt({ aud: 'other-client.apps.googleusercontent.com' }) })).status, 401);
    assert.equal((await post('/auth/google', { credential: signGoogleJwt({ iss: 'https://evil.example.com' }) })).status, 401);
    const hs256Forged = jwt.sign({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'a@b.com', email_verified: true }, 'secret', { algorithm: 'HS256', header: { alg: 'HS256', kid: 'google-test-kid-1' } });
    assert.equal((await post('/auth/google', { credential: hs256Forged })).status, 401);
    assert.equal((await post('/auth/google', { credential: signGoogleJwt({ email_verified: false }) })).status, 403);
    console.log('PASS: rejects forged, wrong-aud/iss, HS256, and unverified-email Google ID tokens');

    // 3. New examiner signs up via Google -> role is strictly 'teacher', emailVerified=true, issues access+media+cookie
    const signupRes = await post('/auth/google', { credential: signGoogleJwt({}) });
    assert.equal(signupRes.status, 201);
    assert.equal(signupRes.body.teacher.role, 'teacher');
    assert.equal(signupRes.body.teacher.emailVerified, true);
    assert.ok(signupRes.body.accessToken);
    assert.ok(signupRes.body.mediaToken);
    assert.match(signupRes.headers.get('set-cookie') || '', /refreshToken=/);
    assert.equal(teachers.length, 1);

    // Password login on Google-only account returns 401 cleanly without crashing bcrypt
    const pwAttempt = await post('/auth/login', { email: 'new.examiner@university.edu', password: 'SomePassword123!' });
    assert.equal(pwAttempt.status, 401);
    assert.match(pwAttempt.body.error, /Google Sign-In/i);
    console.log('PASS: new Google examiner signup defaults to teacher, verifies email, and guards password login');

    // 4. Safe account linking: existing ADMIN email/password account links cleanly without duplicate and preserves role='admin'
    const existingAdmin = new Teacher({
        name: 'System Admin',
        email: 'admin@university.edu',
        passwordHash: '$2b$12$existinghashedpasswordplaceholder1234567890123456789012',
        role: 'admin',
        emailVerified: false,
        emailVerificationRequired: true,
        authProviders: ['local']
    });
    teachers.push(existingAdmin);

    const linkRes = await post('/auth/google', {
        credential: signGoogleJwt({ sub: 'google-sub-admin-77', email: 'admin@university.edu', name: 'Admin Name' })
    });
    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.body.linkedExistingAccount, true);
    assert.equal(linkRes.body.teacher.role, 'admin', 'Linking must preserve existing admin role');
    assert.equal(linkRes.body.teacher.emailVerified, true);
    assert.equal(teachers.length, 2, 'Linking must never create a duplicate teacher record');
    assert.deepEqual(new Set(existingAdmin.authProviders), new Set(['local', 'google']));

    // 5. Reject account hijack when a different Google sub claims an already-linked email
    const hijackRes = await post('/auth/google', {
        credential: signGoogleJwt({ sub: 'google-sub-attacker-999', email: 'admin@university.edu' })
    });
    assert.equal(hijackRes.status, 409, 'Different Google sub cannot overwrite an already-linked googleId');
    console.log('PASS: safe account linking preserves admin role without duplicates and blocks sub hijacking');

    // 6. Gracefully returns 503 when GOOGLE_CLIENT_ID is unset
    delete process.env.GOOGLE_CLIENT_ID;
    assert.equal((await post('/auth/google', { credential: 'anything' })).status, 503);
    console.log('PASS: returns 503 cleanly when GOOGLE_CLIENT_ID is not configured');
}

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => { if (server) server.close(); });
