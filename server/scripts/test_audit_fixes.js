const assert = require('node:assert/strict');
const Exam = require('../src/models/Exam');
const Session = require('../src/models/Session');
const Submission = require('../src/models/Submission');
const { ownsExam, requireOwnedSession } = require('../src/middleware/examAccess');

async function main() {
    const originalExists = Exam.exists;
    const originalFindById = Session.findById;
    try {
        Exam.exists = async query => query.createdBy === 'teacher-a';
        Session.findById = async () => ({ examId: 'EXAM-123' });
        assert.equal(await ownsExam({ teacher: { role: 'teacher', teacherId: 'teacher-a' } }, 'EXAM-123'), true);
        assert.equal(await ownsExam({ teacher: { role: 'teacher', teacherId: 'teacher-b' } }, 'EXAM-123'), false);
        let responseStatus;
        await requireOwnedSession({ teacher: { role: 'teacher', teacherId: 'teacher-b' }, params: { sessionId: '123' } }, {
            status(code) { responseStatus = code; return this; }, json() {}
        }, () => { throw new Error('Cross-teacher session access was allowed'); });
        assert.equal(responseStatus, 404);
        assert.equal(new Submission({ sessionId: '123', submissionType: 'text' }).validateSync(), undefined);
    } finally {
        Exam.exists = originalExists;
        Session.findById = originalFindById;
    }
    console.log('Audit fixes: ownership and empty auto-submission checks passed');
}

main().catch(err => { console.error(err); process.exitCode = 1; });
