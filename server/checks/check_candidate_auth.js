// Run with: npm run check:candidate-auth
// Verifies candidate_session Bearer JWT enforcement across all candidate-facing routes
// and preserves owning-teacher access on shared status/message routes.
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

process.env.SESSION_TOKEN_SECRET = 'candidate-auth-check-secret-32-chars!!';
process.env.JWT_SECRET = 'teacher-auth-check-secret-32-chars!!!!';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';

const Session = require('../src/models/Session');
const Exam = require('../src/models/Exam');
const Teacher = require('../src/models/Teacher');
const Violation = require('../src/models/Violation');
const Submission = require('../src/models/Submission');
const Message = require('../src/models/Message');
const storage = require('../src/services/storage');
const socketApi = require('../src/sockets/violationSocket');
const { signSessionToken } = require('../src/middleware/sessionAuth');
const { generateAccessToken } = require('../src/utils/tokens');

const ownerId = '507f1f77bcf86cd799439001';
const otherTeacherId = '507f1f77bcf86cd799439002';
const adminId = '507f1f77bcf86cd799439003';
const sessionAId = '507f1f77bcf86cd799439011';
const sessionBId = '507f1f77bcf86cd799439012';
const examAId = '507f1f77bcf86cd799439021';
const examBId = '507f1f77bcf86cd799439022';

const exams = new Map([
    ['EXAM-A', {
        _id: examAId, examCode: 'EXAM-A', examId: 'EXAM-A', title: 'Exam A',
        status: 'active', examType: 'online', createdBy: ownerId,
        durationMinutes: 60, extraMinutes: 0, startedAt: new Date(Date.now() - 60000),
        endTime: new Date(Date.now() + 3600000), paperPath: 'uploads/papers/a.pdf',
        paperReleased: false, requireSecondaryCamera: false
    }],
    ['EXAM-B', {
        _id: examBId, examCode: 'EXAM-B', examId: 'EXAM-B', title: 'Exam B',
        status: 'active', examType: 'online', createdBy: otherTeacherId,
        durationMinutes: 60, extraMinutes: 0, startedAt: new Date(Date.now() - 60000),
        endTime: new Date(Date.now() + 3600000), paperPath: 'uploads/papers/b.pdf',
        paperReleased: false, requireSecondaryCamera: false
    }]
]);

const sessions = new Map([
    [sessionAId, new Session({
        _id: sessionAId, studentId: 'ROLL-A', studentName: 'Alice Student', rollNumber: 'ROLL-A',
        examId: 'EXAM-A', status: 'active', consentGiven: true, photoScheduleCreated: true,
        startTime: new Date(Date.now() - 60000), endTime: new Date(Date.now() + 3600000),
        secondaryCamera: { credentialId: 'phone-cred-a', paired: true, placementVerified: true, status: 'verified' }
    })],
    [sessionBId, new Session({
        _id: sessionBId, studentId: 'ROLL-B', studentName: 'Bob Student', rollNumber: 'ROLL-B',
        examId: 'EXAM-B', status: 'active', consentGiven: true, photoScheduleCreated: true,
        startTime: new Date(Date.now() - 60000), endTime: new Date(Date.now() + 3600000)
    })]
]);

const teachers = new Map([
    [ownerId, { _id: ownerId, email: 'owner@test.local', role: 'teacher', emailVerified: true }],
    [otherTeacherId, { _id: otherTeacherId, email: 'other@test.local', role: 'teacher', emailVerified: true }],
    [adminId, { _id: adminId, email: 'admin@test.local', role: 'admin', emailVerified: true }]
]);

const savedViolations = new Map();
const savedSubmissions = new Map();
const savedMessages = [];

const connDesc = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 });

function matchExam(query) {
    const conds = query?.$or || [query];
    for (const exam of exams.values()) {
        for (const c of conds) {
            for (const [k, v] of Object.entries(c || {})) {
                const actual = exam[k];
                if (v instanceof RegExp && typeof actual === 'string' && v.test(actual)) return exam;
                if (!(v instanceof RegExp) && String(actual) === String(v)) return exam;
            }
        }
    }
    return null;
}

Exam.findOne = query => {
    const found = matchExam(query);
    return {
        then: (resolve, reject) => Promise.resolve(found).then(resolve, reject),
        select: () => ({ lean: async () => found, then: (r, j) => Promise.resolve(found).then(r, j) }),
        lean: async () => found
    };
};
Exam.exists = async query => {
    const found = matchExam(query);
    if (!found) return null;
    if (query.createdBy && String(found.createdBy) !== String(query.createdBy)) return null;
    return { _id: found._id };
};
Session.findById = async id => sessions.get(String(id)) || null;
Session.findOneAndUpdate = async (query, update) => {
    const doc = sessions.get(String(query._id));
    if (!doc) return null;
    if (update.$set) Object.entries(update.$set).forEach(([k, v]) => doc.set(k, v));
    return doc;
};
Session.findByIdAndUpdate = async (id, update) => {
    const doc = sessions.get(String(id));
    if (!doc) return null;
    Object.entries(update || {}).forEach(([k, v]) => doc.set(k, v));
    return doc;
};
Teacher.findById = async id => teachers.get(String(id)) || null;
Violation.findById = async id => savedViolations.get(String(id)) || null;
Violation.find = () => ({ sort: async () => [], then: (r, j) => Promise.resolve([]).then(r, j) });
Violation.prototype.save = async function () { savedViolations.set(String(this._id), this); return this; };
Submission.exists = async ({ sessionId }) => [...savedSubmissions.values()].some(s => String(s.sessionId) === String(sessionId));
Submission.prototype.save = async function () { savedSubmissions.set(String(this._id), this); return this; };
Message.prototype.save = async function () { savedMessages.push(this); return this; };
Message.find = query => ({
    sort: async () => savedMessages.filter(m => {
        if (query.examId && m.examId !== query.examId) return false;
        if (query.$or) {
            return query.$or.some(c => c.sessionId && String(m.sessionId) === String(c.sessionId));
        }
        return true;
    })
});
storage.save = async (_buf, filename, folder) => ({ url: `/uploads/${folder}/${filename}`, path: `/uploads/${folder}/${filename}` });
storage.delete = async () => {};
socketApi.broadcastToExam = async () => {};
socketApi.broadcastViolation = async () => {};
socketApi.broadcastRiskScoreUpdate = async () => {};

const app = express();
app.use(express.json({ limit: '2mb' }));
app.locals.io = {};
app.use('/sessions', require('../src/routes/sessions'));
app.use('/', require('../src/routes/violations'));
app.use('/submissions', require('../src/routes/submissions'));
app.use('/exam', require('../src/routes/examPaper'));
app.use('/', require('../src/routes/messages'));

let server;
let base;

async function req(method, urlPath, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${urlPath}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json };
}

async function main() {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    const tokenA = signSessionToken(sessionAId);
    const tokenB = signSessionToken(sessionBId);
    const phoneTokenA = signSessionToken(sessionAId, 'secondary_camera', { jti: 'phone-cred-a' });
    const ownerToken = generateAccessToken(teachers.get(ownerId));
    const otherTeacherToken = generateAccessToken(teachers.get(otherTeacherId));
    const adminToken = generateAccessToken(teachers.get(adminId));
    const validJpeg = 'data:image/jpeg;base64,/9j/2Q==';

    // 1. POST /sessions/:sessionId/camera-verification
    assert.equal((await req('POST', `/sessions/${sessionAId}/camera-verification`, { body: { photoBase64: validJpeg } })).status, 401);
    assert.equal((await req('POST', `/sessions/${sessionAId}/camera-verification`, { token: tokenB, body: { photoBase64: validJpeg } })).status, 401);
    assert.equal((await req('POST', `/sessions/${sessionAId}/camera-verification`, { token: phoneTokenA, body: { photoBase64: validJpeg } })).status, 401);
    assert.equal((await req('POST', `/sessions/${sessionAId}/camera-verification`, { token: tokenA, body: { photoBase64: validJpeg } })).status, 200);
    console.log('PASS: camera-verification enforces candidate_session Bearer auth');

    // 2. GET /sessions/:sessionId/status (Candidate OR owning teacher/admin; works when terminated)
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`)).status, 401);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: tokenB })).status, 401);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: phoneTokenA })).status, 401);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: otherTeacherToken })).status, 403);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: tokenA })).status, 200);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: ownerToken })).status, 200);
    assert.equal((await req('GET', `/sessions/${sessionAId}/status`, { token: adminToken })).status, 200);
    sessions.get(sessionAId).status = 'terminated';
    const terminatedStatus = await req('GET', `/sessions/${sessionAId}/status`, { token: tokenA });
    assert.equal(terminatedStatus.status, 200);
    assert.equal(terminatedStatus.body.status, 'terminated');
    sessions.get(sessionAId).status = 'active';
    console.log('PASS: session status enforces candidate/owner isolation and delivers termination state');

    // 3. POST /violation (front_camera requires candidate_session, blocks unauth/cross-session/phone-scope)
    const vBody = { sessionId: sessionAId, type: 'head_turn_away', severity: 2, timestamp: new Date().toISOString() };
    assert.equal((await req('POST', '/violation', { body: vBody })).status, 401);
    assert.equal((await req('POST', '/violation', { token: tokenB, body: vBody })).status, 401);
    assert.equal((await req('POST', '/violation', { token: phoneTokenA, body: vBody })).status, 401);
    assert.equal((await req('POST', '/violation', { token: tokenA, body: { ...vBody, type: 'secondary_camera_moved' } })).status, 401);
    assert.equal((await req('POST', '/violation', { token: tokenA, body: vBody })).status, 201);
    console.log('PASS: POST /violation enforces scoped session Bearer auth and blocks cross-session/cross-scope forgery');

    // 4. GET /exam/:examId/paper (requires active candidate_session belonging to that exam)
    assert.equal((await req('GET', `/exam/EXAM-A/paper?sessionId=${sessionAId}`)).status, 401);
    assert.equal((await req('GET', `/exam/EXAM-A/paper?sessionId=${sessionAId}`, { token: tokenB })).status, 401);
    assert.equal((await req('GET', `/exam/EXAM-B/paper`, { token: tokenA })).status, 403);
    assert.equal((await req('GET', `/exam/EXAM-A/paper`, { token: tokenA })).status, 423); // Locked in waiting lobby
    console.log('PASS: exam paper delivery requires active session JWT matching the target exam');

    // 5. POST /messages & GET /messages/:sessionId
    const msgBody = { sessionId: sessionAId, examId: 'EXAM-A', sender: 'student', senderName: 'Spoofed Name', text: 'Question 2 clarification?' };
    assert.equal((await req('POST', '/messages', { body: msgBody })).status, 401);
    assert.equal((await req('POST', '/messages', { token: tokenB, body: msgBody })).status, 401);
    assert.equal((await req('POST', '/messages', { token: tokenA, body: { ...msgBody, examId: 'EXAM-B' } })).status, 403);
    const sentMsg = await req('POST', '/messages', { token: tokenA, body: msgBody });
    assert.equal(sentMsg.status, 201);
    assert.equal(sentMsg.body.senderName, 'Alice Student', 'Student chat must derive senderName authoritatively from session');
    assert.equal((await req('GET', `/messages/${sessionAId}`)).status, 401);
    assert.equal((await req('GET', `/messages/${sessionAId}`, { token: tokenB })).status, 401);
    assert.equal((await req('GET', `/messages/${sessionAId}`, { token: otherTeacherToken })).status, 403);
    assert.equal((await req('GET', `/messages/${sessionAId}`, { token: tokenA })).status, 200);
    assert.equal((await req('GET', `/messages/${sessionAId}`, { token: ownerToken })).status, 200);
    console.log('PASS: messages routes enforce candidate/owner auth and prevent identity spoofing');

    // 6. POST /submissions
    assert.equal((await req('POST', '/submissions', { body: { sessionId: sessionAId, answerText: 'My answer' } })).status, 401);
    assert.equal((await req('POST', '/submissions', { token: tokenB, body: { sessionId: sessionAId, answerText: 'My answer' } })).status, 401);
    sessions.get(sessionAId).status = 'terminated';
    assert.equal((await req('POST', '/submissions', { token: tokenA, body: { sessionId: sessionAId, answerText: 'My answer' } })).status, 403);
    sessions.get(sessionAId).status = 'active';
    assert.equal((await req('POST', '/submissions', { token: tokenA, body: { sessionId: sessionAId, answerText: 'My answer' } })).status, 201);
    assert.equal((await req('POST', '/submissions', { token: tokenA, body: { sessionId: sessionAId, answerText: 'Duplicate' } })).status, 404); // Session already completed
    console.log('PASS: submissions enforce candidate_session Bearer auth, block terminated sessions, and block cross-session submits');
}

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => {
        if (server) server.close();
        if (connDesc) Object.defineProperty(mongoose.connection, 'readyState', connDesc);
    });
