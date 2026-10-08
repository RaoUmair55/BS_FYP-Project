// Exercise the real live-alert endpoint without database or network writes.
const assert = require('node:assert/strict');
const Exam = require('../src/models/Exam');
const Session = require('../src/models/Session');
const Violation = require('../src/models/Violation');
const lifecycle = require('../src/utils/examLifecycle');
const router = require('../src/routes/violations');
const originals = [Exam.find, Session.find, Violation.find, lifecycle.autoExpireFinishedExams];
const exams = [
    { _id: 'exam1', examCode: 'EXAM-LIVE', status: 'active', createdBy: 'teacher-a' },
    { _id: 'exam2', examCode: 'EXAM-OLD', status: 'completed', createdBy: 'teacher-a' },
    { _id: 'exam3', examCode: 'EXAM-OTHER', status: 'active', createdBy: 'teacher-b' }
];
const sessions = [
    { _id: 'student1', examId: 'EXAM-LIVE', status: 'active' },
    { _id: 'student2', examId: 'EXAM-LIVE', status: 'completed' },
    { _id: 'old-student', examId: 'EXAM-OLD', status: 'active' },
    { _id: 'other-student', examId: 'EXAM-OTHER', status: 'active' }
];
const alerts = sessions.map((session, i) => ({ _id: `alert${i}`, sessionId: session._id,
    timestamp: new Date(2026, 9, 6, 10, i).toISOString(), toObject() { return { ...this }; } }));
const matches = (value, condition) => condition instanceof RegExp ? condition.test(value) : String(value) === String(condition);
const chain = rows => ({ select: () => ({ lean: async () => rows }) });
async function run() {
    try {
        lifecycle.autoExpireFinishedExams = async () => {};
        Exam.find = query => chain(exams.filter(exam => Object.entries(query).every(([key, value]) => matches(exam[key], value))));
        Session.find = query => chain(sessions.filter(session => query.examId instanceof RegExp
            ? query.examId.test(session.examId) : query.examId.$in.some(value => matches(session.examId, value))));
        Violation.find = query => ({ sort: async () => alerts.filter(alert => !query.sessionId || query.sessionId.$in.includes(alert.sessionId))
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)) });
        const handler = router.stack.find(layer => layer.route?.path === '/violations').route.stack.at(-1).handle;
        async function get(query, role = 'teacher') {
            let output;
            await handler({ query, teacher: { teacherId: 'teacher-a', role }, app: { locals: {} } },
                { json: value => { output = value; }, status: code => { throw new Error(`Unexpected HTTP ${code}`); } });
            return output;
        }
        assert.deepEqual((await get({ active: 'true' })).map(a => a.sessionId), ['student2', 'student1']);
        assert.deepEqual((await get({ active: 'true', examId: 'exam-live', sessionId: 'student1' })).map(a => a.sessionId), ['student1']);
        assert.deepEqual(await get({ active: 'true', examId: 'EXAM-OLD' }), []);
        assert.deepEqual(await get({ active: 'true', sessionId: 'old-student' }), []);
        assert.deepEqual((await get({ active: 'true' }, 'admin')).map(a => a.sessionId), ['other-student', 'student2', 'student1']);
        assert.ok((await get({})).some(a => a.sessionId === 'old-student'), 'History must remain available');
        const { selectLiveAlerts } = await import('../../dashboard/src/utils/liveAlerts.js');
        const items = alerts.map(alert => ({ ...alert, examId: sessions.find(s => s._id === alert.sessionId).examId }));
        assert.deepEqual(selectLiveAlerts(items, exams, 'EXAM-LIVE', 'student1').map(a => a.sessionId), ['student1']);
        assert.deepEqual(selectLiveAlerts(items, exams).map(a => a.sessionId), ['other-student', 'student2', 'student1']);
        assert.deepEqual(selectLiveAlerts(items, exams.map(e => ({ ...e, status: 'completed' }))), []);
        console.log('Live alerts: active-exam isolation, candidate selection, newest-first ordering and history preservation passed.');
    } finally {
        [Exam.find, Session.find, Violation.find, lifecycle.autoExpireFinishedExams] = originals;
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
