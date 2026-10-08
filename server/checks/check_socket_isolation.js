// No database or network mutations: exercise the real broadcast functions with controlled lookups.
const assert = require('node:assert/strict');
const Exam = require('../src/models/Exam');
const Session = require('../src/models/Session');
const Violation = require('../src/models/Violation');
const socketApi = require('../src/sockets/violationSocket');
const originalFindExam = Exam.findOne;
const originalFindSession = Session.findById;
const originalListExams = Exam.find;
const originalListSessions = Session.find;
const originalListViolations = Violation.find;
const lifecycle = require('../src/utils/examLifecycle');
const originalExpire = lifecycle.autoExpireFinishedExams;
const sessionsRouter = require('../src/routes/sessions');
const violationsRouter = require('../src/routes/violations');
const exams = [
    { _id: '507f1f77bcf86cd799439011', examCode: 'EXAM-A', examId: 'ALIAS-A', createdBy: 'teacher-a', status: 'active' },
    { _id: '507f1f77bcf86cd799439012', examCode: 'EXAM-B', examId: 'ALIAS-B', createdBy: 'teacher-b', status: 'completed' }
];
const received = [];
const io = { sockets: { sockets: new Map([
    ['a', { teacher: { id: 'teacher-a', role: 'teacher' }, emit: (event, data) => received.push(['a', event, data]) }],
    ['b', { teacher: { id: 'teacher-b', role: 'teacher' }, emit: (event, data) => received.push(['b', event, data]) }],
    ['admin', { teacher: { id: 'admin', role: 'admin' }, emit: (event, data) => received.push(['admin', event, data]) }],
    ['anonymous', { emit: (event, data) => received.push(['anonymous', event, data]) }]
]) } };

Exam.findOne = query => ({ select: async () => exams.find(exam => query.$or.some(condition =>
    Object.entries(condition).every(([key, value]) => value instanceof RegExp ? value.test(exam[key] || '') : String(exam[key]) === String(value))
)) || null });
Session.findById = async id => id === 'session-a' ? { examId: 'EXAM-A' } : null;

async function check(reference, expected) {
    received.length = 0;
    await socketApi.broadcastToExam(io, reference, 'check', { marker: 'preserved' });
    assert.deepEqual(received.map(item => item[0]), expected, `Wrong recipients for ${reference}`);
    received.forEach(item => assert.deepEqual(item.slice(1), ['check', { marker: 'preserved' }]));
}

(async () => {
    try {
        await check('EXAM-A', ['a', 'admin']); // Original active-exam cross-teacher leak.
        await check('exam-a', ['a', 'admin']);
        await check('ALIAS-A', ['a', 'admin']);
        await check(exams[0]._id, ['a', 'admin']);
        await check('EXAM-B', ['b', 'admin']);
        await check('.*', []); // Treat identifiers literally, not as caller-supplied regex.
        await check('MISSING', []);
        await check(null, []);
        for (const [fn, args, event] of [
            [socketApi.broadcastViolation, [{ sessionId: 'session-a', type: 'head_turn_away' }], 'violation'],
            [socketApi.broadcastRiskScoreUpdate, ['session-a', 42], 'riskScoreUpdate'],
            [socketApi.broadcastViolationReview, [{ sessionId: 'session-a', decision: 'dismissed' }], 'violationReviewed']
        ]) {
            received.length = 0;
            await fn(io, ...args);
            assert.deepEqual(received.map(item => item[0]), ['a', 'admin']);
            assert.ok(received.every(item => item[1] === event));
        }
        received.length = 0;
        await socketApi.broadcastViolation(io, { sessionId: 'missing' });
        assert.deepEqual(received, []);
        // Check the actual roster and priority handlers, not a copy of their filter logic.
        lifecycle.autoExpireFinishedExams = async () => {};
        for (const [router, routePath] of [[sessionsRouter, '/active'], [violationsRouter, '/violations/priority-queue']]) {
            const route = router.stack.find(layer => layer.route?.path === routePath).route;
            const handler = route.stack.at(-1).handle;
            for (const teacher of [{ teacherId: 'teacher-a', role: 'teacher' }, { teacherId: 'admin', role: 'admin' }, { role: 'teacher' }]) {
                let filter = null;
                Exam.find = query => { filter = query; return { select: () => ({ lean: async () => [] }) }; };
                let response;
                const res = { json: value => { response = value; }, status: code => { throw new Error(`Unexpected HTTP ${code}`); } };
                await handler({ teacher, query: {}, app: { locals: { io: null } } }, res);
                assert.deepEqual(response, []);
                if (!teacher.teacherId) assert.equal(filter, null);
                else assert.deepEqual(filter, teacher.role === 'admin' ? { status: 'active' } : { status: 'active', createdBy: teacher.teacherId });
            }
        }
        const ownedId = '507f1f77bcf86cd799439013';
        const victimId = '507f1f77bcf86cd799439014';
        const ownedSession = { _id: ownedId, studentId: victimId, sessionId: victimId, examId: 'EXAM-A' };
        Exam.find = () => ({ select: () => ({ lean: async () => [exams[0]] }) });
        Session.find = () => ({
            select: () => ({ lean: async () => [ownedSession] }),
            lean: async () => [ownedSession]
        });
        for (const [routePath, query] of [['/violations', {}], ['/violations', { active: 'true' }], ['/violations/priority-queue', {}]]) {
            let violationFilter;
            Violation.find = filter => {
                violationFilter = filter;
                const result = Promise.resolve([]);
                result.lean = async () => [];
                return { sort: () => result };
            };
            const handler = violationsRouter.stack.find(layer => layer.route?.path === routePath).route.stack.at(-1).handle;
            await handler({ teacher: { teacherId: 'teacher-a', role: 'teacher' }, query, app: { locals: { io: null } } }, {
                json: value => assert.deepEqual(value, []), status: code => { throw new Error(`Unexpected HTTP ${code}`); }
            });
            assert.deepEqual(violationFilter.sessionId.$in, [ownedId], `${routePath} must exclude candidate-controlled aliases`);
        }
        console.log('PASS: owner/admin isolation, identifier aliases, literal matching and session broadcasts');
        console.log('PASS: actual roster and priority handlers enforce teacher scope and preserve admin access');
        console.log('PASS: student-ID/session-ID collisions cannot expand violation access');
    } finally {
        Exam.findOne = originalFindExam;
        Session.findById = originalFindSession;
        Exam.find = originalListExams;
        Session.find = originalListSessions;
        Violation.find = originalListViolations;
        lifecycle.autoExpireFinishedExams = originalExpire;
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
