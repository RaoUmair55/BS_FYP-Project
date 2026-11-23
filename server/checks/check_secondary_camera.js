// Isolated models, real HTTP + Socket.io. No camera, emails or production data.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { io: client } = require('../../dashboard/node_modules/socket.io-client');
process.env.SESSION_TOKEN_SECRET = 'side-camera-test-secret-only-32-characters';
process.env.JWT_SECRET = 'teacher-test-secret-only-32-characters';
process.env.PUBLIC_URL = 'https://backend.example.test';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
const Session = require('../src/models/Session'), Exam = require('../src/models/Exam');
const Violation = require('../src/models/Violation'), Teacher = require('../src/models/Teacher');
const { signSessionToken, authenticate } = require('../src/middleware/sessionAuth');
const sessions = new Map(), violations = new Map(), audit = [];
const exam = { examCode: 'EXAM-SIDE', status: 'active', requireSecondaryCamera: true,
    createdBy: 'owner', startedAt: new Date(), paperReleased: true };
const get = (o, key) => key.split('.').reduce((v, k) => v?.[k], o);
function matches(doc, query) {
    return Object.entries(query).every(([key, value]) => {
        if (key === '$or') return value.some(part => matches(doc, part));
        const actual = get(doc, key);
        if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) {
            return Object.entries(value).every(([op, expected]) => op === '$gt' ? actual > expected :
                op === '$lt' ? actual < expected : op === '$ne' ? (expected === null ? actual != null : actual !== expected) : false);
        }
        return value === null ? actual == null : String(actual) === String(value);
    });
}
function update(doc, data) {
    for (const [key, value] of Object.entries(data.$set || {})) doc.set(key, value);
    return doc;
}
Session.findById = async id => sessions.get(String(id)) || null;
Session.find = async query => [...sessions.values()].filter(s => matches(s, query));
Session.updateOne = async (query, data) => { const doc = [...sessions.values()].find(s => matches(s, query)); if (doc) update(doc, data); return { matchedCount: doc ? 1 : 0 }; };
Session.findOneAndUpdate = async (query, data) => { const doc = [...sessions.values()].find(s => matches(s, query)); return doc ? update(doc, data) : null; };
Exam.findOne = () => ({ then: (resolve, reject) => Promise.resolve(exam).then(resolve, reject), select: async () => exam });
Teacher.findById = async id => ({ _id: id, role: id === 'admin' ? 'admin' : 'teacher', emailVerified: true });
Violation.findById = async id => violations.get(String(id));
Violation.find = query => ({ sort: async () => [...violations.values()].filter(v => matches(v, query)) });
Violation.findOneAndUpdate = async (query, data) => {
    if (!violations.has(String(query._id))) violations.set(String(query._id), new Violation({ _id: query._id, ...data.$setOnInsert }));
    return violations.get(String(query._id));
};
Violation.prototype.save = async function () { violations.set(String(this._id), this); return this; };
require('../src/utils/auditLogger').logTeacherAction = async (_req, data) => audit.push(data);
const storage = require('../src/services/storage');
storage.save = async () => ({ url: '/uploads/screenshots/side-test.jpg' });
storage.delete = async () => {};
const app = express(); app.use(express.json());
const server = http.createServer(app), sockets = require('../src/sockets/violationSocket').initSocket(server);
app.locals.io = sockets;
app.use('/side-camera', require('../src/routes/sideCameraPage'));
app.use(require('helmet')());
app.get('/default-policy', (_req, res) => res.json({ ok: true }));
app.use('/pairing', require('../src/routes/pairing'));
app.use('/', require('../src/routes/violations'));
const mongoose = require('mongoose');
Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
const { watchdog, publishStatus, requestDeskSnapshot } = require('../src/services/secondaryCamera');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
let base;
async function post(route, body, token) {
    const result = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: result.status, data: await result.json() };
}
async function connect(token, scope) {
    const socket = client(base, { auth: { token, ...(scope ? { scope } : {}) }, transports: ['websocket'], reconnection: false }); clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
}
async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
    const candidateHandshake = await fetch(base + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: 'null' } });
    assert.equal(candidateHandshake.headers.get('access-control-allow-origin'), 'null', 'Electron file-origin handshake must be allowed before JWT namespace authentication');
    const phonePage = await fetch(base + '/side-camera/');
    assert.equal(phonePage.status, 200);
    assert(phonePage.headers.get('content-security-policy').includes("'wasm-unsafe-eval'"));
    assert(phonePage.headers.get('permissions-policy').includes('camera=(self)'));
    assert.equal(phonePage.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(phonePage.headers.get('cache-control'), 'no-store');
    assert(!(await fetch(base + '/default-policy')).headers.get('content-security-policy').includes('wasm-unsafe-eval'));
    for (const file of ['vendor/vision_bundle.mjs', 'vendor/wasm/vision_wasm_internal.wasm', 'vendor/wasm/vision_wasm_nosimd_internal.wasm', 'models/efficientdet_lite0.tflite']) {
        const response = await fetch(base + '/side-camera/' + file); assert.equal(response.status, 200, file); await response.arrayBuffer();
    }
    const session = new Session({ studentId: 'test', examId: exam.examCode, startTime: new Date(Date.now() - 60000), endTime: new Date(Date.now() + 600000), requireSecondaryCamera: true });
    const other = new Session({ studentId: 'other', examId: exam.examCode });
    sessions.set(String(session._id), session); sessions.set(String(other._id), other);
    const candidate = signSessionToken(session._id), otherCandidate = signSessionToken(other._id);
    assert.equal((await post('/pairing/create', { sessionId: session._id })).status, 401);
    assert.equal((await post('/pairing/create', { sessionId: other._id }, candidate)).status, 401);
    let created = await post('/pairing/create', { sessionId: session._id }, candidate);
    assert.equal(created.status, 200); assert.match(created.data.token, /^[a-f0-9]{64}$/); assert.match(created.data.qrImage, /^data:image\/png;base64,/);
    assert.equal(session.sideCameraPairing.hash, createHash('sha256').update(created.data.token).digest('hex'));
    assert(!JSON.stringify(session.sideCameraPairing).includes(created.data.token));
    const replaced = created.data.token;
    created = await post('/pairing/create', { sessionId: session._id }, candidate);
    assert.equal((await post('/pairing/redeem', { token: replaced })).status, 401);
    session.sideCameraPairing.expiresAt = new Date(Date.now() - 1);
    assert.equal((await post('/pairing/redeem', { token: created.data.token })).status, 401);
    created = await post('/pairing/create', { sessionId: session._id }, candidate);
    const redeemed = await post('/pairing/redeem', { token: created.data.token }); assert.equal(redeemed.status, 200);
    const phoneToken = redeemed.data.token, claims = jwt.verify(phoneToken, process.env.SESSION_TOKEN_SECRET);
    assert.equal(claims.scope, 'secondary_camera'); assert.equal(claims.exp - claims.iat, 14400);
    assert.equal((await post('/pairing/redeem', { token: created.data.token })).status, 401);
    assert.equal((await post('/pairing/create', { sessionId: session._id }, phoneToken)).status, 401);
    await assert.rejects(authenticate(phoneToken, 'secondary_camera', String(other._id)));
    await assert.rejects(authenticate(jwt.sign({ sessionId: String(session._id), scope: 'secondary_camera' }, process.env.SESSION_TOKEN_SECRET, { expiresIn: -1 }), 'secondary_camera'));
    assert.equal((await post('/pairing/start', { sessionId: session._id }, candidate)).status, 409);
    const laptop = await connect(candidate, 'candidate_session'), otherLaptop = await connect(otherCandidate, 'candidate_session');
    const owner = await connect(require('../src/utils/tokens').generateAccessToken({ _id: 'owner' }));
    const outsider = await connect(require('../src/utils/tokens').generateAccessToken({ _id: 'outsider' }));
    const admin = await connect(require('../src/utils/tokens').generateAccessToken({ _id: 'admin', role: 'admin' }));
    let ownerStatuses = 0, lastOwnerStatus = null, leaked = 0, previews = 0;
    owner.on('secondaryCameraStatus', payload => { ownerStatuses++; lastOwnerStatus = payload; });
    for (const s of [otherLaptop, owner, outsider, admin]) s.on('preview-frame', () => leaked++);
    outsider.on('secondaryCameraStatus', () => leaked++); admin.on('secondaryCameraStatus', () => leaked++);
    laptop.on('preview-frame', () => previews++);
    const phone = await connect(phoneToken, 'secondary_camera'); await sleep(60);
    await publishStatus(sockets, session); await sleep(30); assert(ownerStatuses > 0);
    const image = 'data:image/jpeg;base64,/9j/2Q==';
    phone.emit('preview-frame', image); phone.emit('preview-frame', image); phone.emit('preview-frame', image); phone.emit('preview-frame', image);
    phone.emit('preview-frame', 'data:image/jpeg;base64,' + 'A'.repeat(62 * 1024));
    await sleep(120); assert(previews > 0 && previews <= 3); assert.equal(leaked, 0);
    const before = previews;
    phone.emit('placement-result', { verified: true, criteria: { person: true, workstation: false, lighting: true, steady: true }, orientation: { alpha: 0, beta: 0, gamma: 0 } });
    await sleep(40); assert.equal(session.secondaryCamera.placementVerified, false);
    // The rate limiter deliberately spaces placement reports, including invalid ones.
    await sleep(750);
    await new Promise(resolve => phone.emit('placement-result', { verified: true, fixedStandMode: true, criteria: { person: true, workstation: true, lighting: true, steady: true }, orientation: { alpha: 0, beta: 0, gamma: 0 } }, resolve));
    assert.equal(session.secondaryCamera.fixedStandMode, true);
    assert.equal(lastOwnerStatus?.fixedStandMode, true);
    phone.emit('preview-frame', image); await sleep(50); assert.equal(previews, before);
    // Clean desk baseline reference photo upload & examiner on-demand desk check signal.
    const sendRefPhoto = async (sid, token, bytes = Buffer.from('/9j/2Q==', 'base64'), mime = 'image/jpeg') => {
        const form = new FormData();
        form.append('sessionId', sid);
        form.append('source', 'initial');
        form.append('screenshot', new Blob([bytes], { type: mime }), 'desk.jpg');
        return fetch(base + '/pairing/reference-photo', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    };
    assert.equal((await sendRefPhoto(String(other._id), phoneToken)).status, 401);
    assert.equal((await sendRefPhoto(String(session._id), null)).status, 401);
    assert.equal((await sendRefPhoto(String(session._id), phoneToken, Buffer.from('not-a-jpeg'), 'image/jpeg')).status, 400);
    const refRes = await sendRefPhoto(String(session._id), phoneToken);
    assert.equal(refRes.status, 201);
    await sleep(30);
    assert.equal(session.secondaryCamera.referencePhoto, '/uploads/screenshots/side-test.jpg');
    assert.equal(lastOwnerStatus?.referencePhoto, '/uploads/screenshots/side-test.jpg');
    let deskRequests = 0;
    phone.on('request-desk-snapshot', () => deskRequests++);
    assert.equal(requestDeskSnapshot(sockets, String(session._id)), true);
    assert.equal(requestDeskSnapshot(sockets, String(other._id)), false);
    await sleep(30);
    assert.equal(deskRequests, 1);
    assert.equal((await post('/pairing/start', { sessionId: session._id, prepare: true }, candidate)).status, 200);
    assert.equal(session.candidateMonitoringStartedAt, null);
    assert.equal((await post('/pairing/start', { sessionId: session._id }, candidate)).status, 200);
    const now = new Date(); session.secondaryCamera.lastHeartbeatAt = new Date(+now - 26000);
    session.candidateMonitoringStartedAt = null; await watchdog(sockets, now); assert.equal(violations.size, 0);
    session.candidateMonitoringStartedAt = new Date(); session.secondaryCamera.lastHeartbeatAt = new Date(+now - 24000);
    await watchdog(sockets, now); assert.equal(violations.size, 0);
    session.secondaryCamera.lastHeartbeatAt = new Date(+now - 26000);
    session.secondaryCamera.disconnectedAt = new Date(+now - 20000); await watchdog(sockets, now); assert.equal(violations.size, 0);
    session.secondaryCamera.disconnectedAt = new Date(+now - 26000);
    exam.endTime = new Date(+now - 1); await watchdog(sockets, now); assert.equal(violations.size, 0, 'Expired exam must not create a disconnect alert'); delete exam.endTime;
    await watchdog(sockets, now); await watchdog(sockets, now); assert.equal(violations.size, 1); assert.equal(session.secondaryCamera.status, 'lost');
    const lost = [...violations.values()][0]; assert.equal(lost.source, 'side_camera'); assert.equal(lost.severity, 3);
    await new Promise(resolve => phone.emit('heartbeat', { orientation: { alpha: 0, beta: 0, gamma: 0 }, luminance: 50, trackLive: true }, resolve));
    assert.equal(session.secondaryCamera.status, 'verified'); assert.equal(session.secondaryCamera.disconnectedAt, null);
    // Reuse the real multipart ingestion handler and enforce the phone's allowed types, authoritative severities, and session.
    const sendEvent = async (sid, token, source = 'side_camera', type = 'secondary_camera_moved', severity = 1) => {
        const form = new FormData(); for (const [k, v] of Object.entries({ sessionId: sid, source, type, severity, timestamp: new Date().toISOString(), eventId: require('node:crypto').randomUUID() })) form.append(k, v);
        form.append('screenshot', new Blob([Buffer.from('/9j/2Q==', 'base64')], { type: 'image/jpeg' }), 'test.jpg');
        return fetch(base + '/violation', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    };
    assert.equal((await sendEvent(String(other._id), phoneToken)).status, 401);
    assert.equal((await sendEvent(String(session._id), null)).status, 401);
    assert.equal((await sendEvent(String(session._id), phoneToken, 'front_camera')).status, 401);
    assert.equal((await sendEvent(String(session._id), phoneToken, 'side_camera', 'unauthorized_app')).status, 401);
    assert.equal((await sendEvent(String(session._id), phoneToken, 'side_camera', 'usb_device_detected')).status, 401);
    for (const [type, expectedSeverity] of [
        ['secondary_camera_moved', 3],
        ['secondary_camera_obstructed', 3],
        ['no_face_detected', 3],
        ['cell_phone', 4],
        ['unauthorized_object', 4],
        ['second_person_detected', 5]
    ]) {
        const res = await sendEvent(String(session._id), phoneToken, 'side_camera', type, 1);
        assert.equal(res.status, 201, type);
        const body = await res.json();
        assert.equal(body.severity, expectedSeverity, `${type} must enforce authoritative server severity ${expectedSeverity}`);
    }
    exam.requireSecondaryCamera = false;
    assert.equal((await post('/pairing/create', { sessionId: session._id }, candidate)).status, 409);
    session.secondaryCamera.lastHeartbeatAt = new Date(+now - 60000); session.secondaryCamera.status = 'verified';
    const count = violations.size; await watchdog(sockets, now); assert.equal(violations.size, count);
    const { placementCriteria, orientationDistance, tiltDistance, analyzeDeskFrame } = await import('../public/side-camera/rules.mjs');
    const detection = (name, box, score = 0.85) => ({ categories: [{ categoryName: name, score }], boundingBox: box });
    const person = detection('person', { originX: 20, originY: 20, width: 200, height: 300 });
    const workstation = detection('laptop');
    const criteria = (ds = [person, workstation], light = 100, steady = true) => placementCriteria(ds, 640, 480, light, {}, steady);
    assert(Object.values(criteria()).every(Boolean)); assert.equal(criteria([workstation]).person, false);
    assert.equal(criteria([person]).workstation, false); assert.equal(criteria(undefined, 1).lighting, false);
    assert.equal(criteria(undefined, 100, false).steady, false);
    assert.equal(criteria([detection('person', { originX: 0, originY: 0, width: 640, height: 480 }), workstation]).person, false);
    // Seated desk-side student touching left/right/bottom frame edge must pass;
    // cropped head at top edge, arm-only sliver, or tiny background person must fail.
    assert.equal(criteria([detection('person', { originX: 0, originY: 30, width: 220, height: 450 }), workstation]).person, true);
    assert.equal(criteria([detection('person', { originX: 120, originY: 2, width: 220, height: 420 }), workstation]).person, false, 'Head cropped at top edge must fail');
    assert.equal(criteria([detection('person', { originX: 430, originY: 30, width: 210, height: 450 }), detection('mouse')]).workstation, true);
    assert.equal(criteria([person, detection('tv')]).workstation, true);
    assert.equal(criteria([detection('person', { originX: 120, originY: 120, width: 80, height: 120 }), workstation]).person, false, 'Small sliver/arm must fail');
    assert.equal(orientationDistance({ alpha: 359, beta: 0, gamma: 0 }, { alpha: 1, beta: 0, gamma: 0 }), 2);
    assert.equal(tiltDistance({ alpha: 0, beta: 10, gamma: 5 }, { alpha: 180, beta: 12, gamma: 5 }), 2);
    // Part 2 desk-frame AI rules (and stricter 0.52 confidence guard so setup's 0.38 never causes false exam alerts):
    assert.deepEqual(analyzeDeskFrame([person, workstation], 640, 480), { personCount: 1, secondPerson: false, personAbsent: false, workstationVisible: true, unauthorizedObject: null });
    assert.equal(analyzeDeskFrame([person, workstation, detection('cell phone', { originX: 220, originY: 300, width: 60, height: 40 }, 0.42)], 640, 480).unauthorizedObject, null);
    assert.equal(analyzeDeskFrame([person, workstation, detection('cell phone', { originX: 220, originY: 300, width: 60, height: 40 }, 0.72)], 640, 480).unauthorizedObject.type, 'cell_phone');
    assert.equal(analyzeDeskFrame([person, workstation, detection('book', { originX: 250, originY: 320, width: 90, height: 60 }, 0.7)], 640, 480).unauthorizedObject.type, 'unauthorized_object');
    assert.equal(analyzeDeskFrame([person, workstation, detection('laptop', { originX: 300, originY: 200, width: 140, height: 90 }, 0.8)], 640, 480).unauthorizedObject.type, 'unauthorized_object');
    assert.equal(analyzeDeskFrame([person, detection('person', { originX: 340, originY: 30, width: 180, height: 320 }), workstation], 640, 480).secondPerson, true);
    assert.equal(analyzeDeskFrame([person, detection('person', { originX: 550, originY: 100, width: 30, height: 60 }), workstation], 640, 480).secondPerson, false);
    assert.equal(analyzeDeskFrame([workstation], 640, 480).personAbsent, true);
    assert(audit.some(a => a.action === 'SIDE_CAMERA_PAIRED')); assert(!JSON.stringify(audit).includes(created.data.token));
    console.log('PASS: pairing hashing/replacement/expiry/reuse, scope/session isolation, 4h JWT, preview rate/size/privacy/stop, placement & Part-2 desk AI rules, reference photo + desk check signal, fixedStandMode, owner-only status, start gate, watchdog/grace/reconnect/idempotency, scoped snapshot ingestion and disabled exams.');
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => { clients.forEach(c => c.disconnect()); await new Promise(resolve => sockets.close(resolve)); });
