// Exercise the real dashboard action with mocked API and React setters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Dashboard.jsx'), 'utf8');
const start = source.indexOf('    const handleEndCurrentExam =');
const body = source.slice(start, source.indexOf('\n    return (', start));
async function check(fail) {
    const state = { exams: [{ _id: 'database-id', examCode: 'EXAM-LIVE' }], modal: true };
    const calls = [];
    const api = { patch: async (...args) => { calls.push(args); if (fail) throw { response: { data: { error: 'Permission denied' } } }; } };
    const setters = {
        setEndingExam: value => { state.busy = value; },
        setEndExamError: value => { state.error = value; },
        setActiveExams: update => { state.exams = update(state.exams); },
        setSelectedExamFilter: value => { state.exam = value; },
        setSelectedSessionId: value => { state.student = value; },
        setShowEndExamConfirm: value => { state.modal = value; },
        setActiveTab: value => { state.tab = value; }
    };
    const action = new Function('api', 'activeExams', 'selectedExamFilter', 'endingExam', 'console', ...Object.keys(setters),
        `${body}; return handleEndCurrentExam;`)(api, state.exams, 'EXAM-LIVE', false, { error() {} }, ...Object.values(setters));
    await action();
    assert.deepEqual(calls, [['/exams/database-id/status', { status: 'completed' }]]);
    assert.equal(state.busy, false);
    if (fail) { assert.equal(state.modal, true); assert.equal(state.error, 'Permission denied'); assert.equal(state.exams.length, 1); }
    else { assert.equal(state.modal, false); assert.equal(state.exams.length, 0); assert.equal(state.student, null); assert.equal(state.tab, 'history'); }
}
Promise.all([check(false), check(true)]).then(() => console.log('PASS: End Exam uses database ID, clears live selection on success, and preserves errors for retry.'), error => { console.error(error); process.exitCode = 1; });
