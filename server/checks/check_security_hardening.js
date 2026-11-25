// Run with: npm run check:security
// Verifies Step 2 security hardening:
// 1. Legacy GET /exam owner scoping
// 2. Submission upload fileFilter (blocks HTML/SVG/JS XSS) & forced attachment/nosniff/CSP headers
// 3. Regex escaping in /admin/assets/purge-exam (blocks examId: ".*")
// 4. Single-use atomic password-reset tokens
// 5. Media-scoped vs API-access token isolation
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');

process.env.JWT_SECRET = 'security-hardening-jwt-secret-32-chars!!';
process.env.RESET_TOKEN_SECRET = 'security-hardening-reset-secret-32-char!';
process.env.SESSION_TOKEN_SECRET = 'security-hardening-session-secret-32ch!!';
process.env.REQUIRE_EMAIL_VERIFICATION = 'false';

const Teacher = require('../src/models/Teacher');
const Exam = require('../src/models/Exam');
const Session = require('../src/models/Session');
const Submission = require('../src/models/Submission');
const Violation = require('../src/models/Violation');
const RefreshToken = require('../src/models/RefreshToken');
const AuthAuditLog = require('../src/models/AuthAuditLog');
const storage = require('../src/services/storage');
const audit = require('../src/utils/auditLogger');
const {
    generateAccessToken,
    generateMediaToken,
    verifyAccessToken,
    verifyMediaToken,
    hashToken
} = require('../src/utils/tokens');
const { signSessionToken } = require('../src/middleware/sessionAuth');
const { escapeRegex, exactCaseInsensitiveRegex } = require('../src/utils/regex');

const teacherAId = '507f1f77bcf86cd799439101';
const teacherBId = '507f1f77bcf86cd799439102';
const adminId = '507f1f77bcf86cd799439103';
const sessionAId = '507f1f77bcf86cd799439111';
const submissionAId = '507f1f77bcf86cd799439121';

const teachers = new Map([
    [teacherAId, { _id: teacherAId, email: 'a@test.local', role: 'teacher', emailVerified: true, passwordResetTokenHash: null, passwordResetExpiresAt: null }],
    [teacherBId, { _id: teacherBId, email: 'b@test.local', role: 'teacher', emailVerified: true, passwordResetTokenHash: null, passwordResetExpiresAt: null }],
    [adminId, { _id: adminId, email: 'admin@test.local', role: 'admin', emailVerified: true, passwordResetTokenHash: null, passwordResetExpiresAt: null }]
]);

const exams = [
    { _id: '507f1f77bcf86cd799439201', examCode: 'EXAM-A', examId: 'EXAM-A', title: 'Exam A', createdBy: teacherAId, paperPath: '/uploads/papers/a.pdf' },
    { _id: '507f1f77bcf86cd799439202', examCode: 'EXAM-B', examId: 'EXAM-B', title: 'Exam B', createdBy: teacherBId, paperPath: '/uploads/papers/b.pdf' }
];

const sessions = new Map([
    [sessionAId, new Session({ _id: sessionAId, studentId: 'S1', examId: 'EXAM-A', status: 'active', startTime: new Date(Date.now() - 60000), endTime: new Date(Date.now() + 3600000) })]
]);

let savedSubmissionDoc = null;
const deletedUrls = [];

Teacher.findById = async id => teachers.get(String(id)) || null;
Teacher.findOneAndUpdate = async (query, update) => {
    const t = teachers.get(String(query._id));
    if (!t) return null;
    if (query.passwordResetTokenHash && t.passwordResetTokenHash !== query.passwordResetTokenHash) return null;
    if (query.passwordResetExpiresAt?.$gt && (!t.passwordResetExpiresAt || t.passwordResetExpiresAt <= query.passwordResetExpiresAt.$gt)) return null;
    Object.assign(t, update.$set || {});
    return t;
};
RefreshToken.updateMany = async () => ({ modifiedCount: 0 });
AuthAuditLog.create = async () => ({});
audit.logTeacherAction = async () => {};

Exam.find = filter => ({
    sort: async () => exams.filter(e => !filter?.createdBy || String(e.createdBy) === String(filter.createdBy))
});
Exam.findOne = async query => {
    const conds = query?.$or || [query];
    return exams.find(e => conds.some(c => Object.entries(c).every(([k, v]) =>
        v instanceof RegExp ? v.test(e[k] || '') : String(e[k]) === String(v)
    ))) || null;
};
Exam.exists = async query => {
    const found = await Exam.findOne(query);
    if (!found) return null;
    if (query.createdBy && String(found.createdBy) !== String(query.createdBy)) return null;
    return { _id: found._id };
};
Exam.updateOne = async () => ({ modifiedCount: 0 });
Session.findById = async id => sessions.get(String(id)) || null;
Session.find = async query => [...sessions.values()].filter(s => {
    if (query.examId instanceof RegExp) return query.examId.test(s.examId);
    return !query.examId || s.examId === query.examId;
});
Session.findByIdAndUpdate = async () => null;
Violation.find = async () => [];
Submission.exists = async () => false;
Submission.prototype.save = async function () { savedSubmissionDoc = this; return this; };
Submission.findById = async id => String(id) === submissionAId ? savedSubmissionDoc : null;
storage.save = async (_buf, filename, folder) => ({ url: `/uploads/${folder}/${filename}`, path: `/uploads/${folder}/${filename}` });
storage.delete = async url => { deletedUrls.push(url); };

const app = express();
app.use(express.json());
app.use('/exam', require('../src/routes/examPaper'));
app.use('/submissions', require('../src/routes/submissions'));
app.use('/admin', require('../src/routes/admin'));
app.use('/auth', require('../src/routes/auth'));

let server;
let base;
let tempSubmissionFile;

async function main() {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    const teacherAToken = generateAccessToken(teachers.get(teacherAId));
    const adminToken = generateAccessToken(teachers.get(adminId));
    const mediaAToken = generateMediaToken(teachers.get(teacherAId));
    const sessionAToken = signSessionToken(sessionAId);

    // 1. Token scope isolation (media_read cannot call API routes; teacher_access cannot pass verifyMediaToken)
    assert.equal(verifyAccessToken(teacherAToken).scope, 'teacher_access');
    assert.equal(verifyMediaToken(mediaAToken).scope, 'media_read');
    assert.throws(() => verifyAccessToken(mediaAToken));
    assert.throws(() => verifyMediaToken(teacherAToken));
    const apiWithMedia = await fetch(`${base}/exam`, { headers: { Authorization: `Bearer ${mediaAToken}` } });
    assert.equal(apiWithMedia.status, 401, 'media_read token must be rejected by requireAuth');
    console.log('PASS: media_read and teacher_access JWT scopes are strictly isolated');

    // 2. Legacy GET /exam enforces owner scoping (admin sees all, teacher sees only own)
    const teacherExamsRes = await fetch(`${base}/exam`, { headers: { Authorization: `Bearer ${teacherAToken}` } });
    assert.equal(teacherExamsRes.status, 200);
    const teacherExams = await teacherExamsRes.json();
    assert.deepEqual(teacherExams.map(e => e.examCode), ['EXAM-A']);
    const adminExamsRes = await fetch(`${base}/exam`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal((await adminExamsRes.json()).length, 2);
    console.log('PASS: legacy GET /exam enforces teacher owner isolation');

    // 3. Submission upload XSS prevention + forced attachment headers
    for (const [fname, mime] of [
        ['exploit.html', 'text/html'],
        ['vector.svg', 'image/svg+xml'],
        ['payload.js', 'application/javascript'],
        ['evil.exe', 'application/x-msdownload']
    ]) {
        const form = new FormData();
        form.append('sessionId', sessionAId);
        form.append('file', new Blob(['<script>alert(1)</script>'], { type: mime }), fname);
        const res = await fetch(`${base}/submissions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${sessionAToken}` },
            body: form
        });
        assert.equal(res.status, 400, `${fname} must be rejected by fileFilter`);
    }
    const validForm = new FormData();
    validForm.append('sessionId', sessionAId);
    validForm.append('file', new Blob(['%PDF-1.4\n%test'], { type: 'application/pdf' }), 'answer.pdf');
    const okSub = await fetch(`${base}/submissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionAToken}` },
        body: validForm
    });
    assert.equal(okSub.status, 201);

    // Verify GET /submissions/:id/file sets attachment + nosniff + sandbox CSP
    const uploadsSubsDir = path.resolve(__dirname, '../uploads/submissions');
    fs.mkdirSync(uploadsSubsDir, { recursive: true });
    tempSubmissionFile = path.join(uploadsSubsDir, `security_check_${Date.now()}.txt`);
    fs.writeFileSync(tempSubmissionFile, 'clean answer');
    savedSubmissionDoc = {
        _id: submissionAId,
        sessionId: sessionAId,
        filename: 'answer.txt',
        filePath: `/uploads/submissions/${path.basename(tempSubmissionFile)}`
    };
    const fileRes = await fetch(`${base}/submissions/${submissionAId}/file`, {
        headers: { Authorization: `Bearer ${teacherAToken}` }
    });
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers.get('x-content-type-options'), 'nosniff');
    assert.match(fileRes.headers.get('content-disposition') || '', /^attachment;/i);
    assert.match(fileRes.headers.get('content-security-policy') || '', /sandbox/i);
    console.log('PASS: submissions block active web uploads and enforce attachment + nosniff + sandbox headers');

    // 4. Regex escaping prevents wildcard purge-exam attack (examId: ".*")
    assert.equal(escapeRegex('EXAM-A.*'), 'EXAM-A\\.\\*');
    assert.equal(exactCaseInsensitiveRegex('.*').test('EXAM-A'), false);
    const purgeRes = await fetch(`${base}/admin/assets/purge-exam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ examId: '.*' })
    });
    assert.equal(purgeRes.status, 200);
    const purgeData = await purgeRes.json();
    assert.equal(purgeData.totalPurged, 0, 'Wildcard regex examId ".*" must purge 0 assets');
    assert.equal(deletedUrls.length, 0);
    console.log('PASS: regex escaping blocks wildcard /admin/assets/purge-exam');

    // 5. Password-reset JWT is strictly single-use
    const jti = randomUUID();
    const tA = teachers.get(teacherAId);
    tA.passwordResetTokenHash = hashToken(jti);
    tA.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const resetJwt = jwt.sign(
        { teacherId: teacherAId, email: tA.email, type: 'password_reset', jti },
        process.env.RESET_TOKEN_SECRET,
        { expiresIn: '30m' }
    );
    const firstReset = await fetch(`${base}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetJwt, newPassword: 'StrongNewPassword123!' })
    });
    assert.equal(firstReset.status, 200);
    const secondReset = await fetch(`${base}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetJwt, newPassword: 'AnotherPassword456!' })
    });
    assert.equal(secondReset.status, 400, 'Reused password reset token must be rejected');
    console.log('PASS: password-reset tokens are atomically single-use');
}

main()
    .catch(err => { console.error(err); process.exitCode = 1; })
    .finally(() => {
        if (server) server.close();
        if (tempSubmissionFile && fs.existsSync(tempSubmissionFile)) {
            fs.rmSync(tempSubmissionFile, { force: true });
        }
    });
