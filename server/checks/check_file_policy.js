// Read-only model/route doubles: exact teacher-approved paths survive create + candidate lookup.
const assert = require('node:assert/strict');
const Exam = require('../src/models/Exam');
const audit = require('../src/utils/auditLogger');
const oldFind = Exam.findOne;
const oldSave = Exam.prototype.save;
const oldLog = audit.logTeacherAction;
let saved;
Exam.findOne = async () => null;
Exam.prototype.save = async function () { saved = this; return this; };
audit.logTeacherAction = async () => {};
const router = require('../src/routes/exams');
const create = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack.at(-1).handle;
async function call(paths) {
  let result;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { result = { status: this.statusCode, body }; return this; } };
  await create({ body: { title: 'Policy check', status: 'draft', rules: { permittedFiles: paths } },
    teacher: { teacherId: '507f1f77bcf86cd799439011' }, app: { locals: {} } }, res);
  return result;
}
(async () => {
  try {
    for (const invalid of [['notes.docx'], ['C:\\Exam\\*.docx'], 'C:\\Exam\\notes.docx', [null], Array(51).fill('C:\\Exam\\notes.docx')]) {
      assert.equal((await call(invalid)).status, 400);
    }
    const paths = ['C:\\Exam\\template.docx', '\\\\labserver\\exam\\reference.pdf'];
    const result = await call(paths);
    assert.equal(result.status, 201);
    assert.deepEqual([...saved.rules.permittedFiles], paths);
    Exam.findOne = async () => saved;
    const lookup = router.stack.find(layer => layer.route?.path === '/code/:code').route.stack.at(-1).handle;
    let candidate;
    await lookup({ params: { code: saved.examCode } }, { json(body) { candidate = body; } });
    assert.deepEqual([...candidate.rules.permittedFiles], paths);
    assert.deepEqual(new Exam({ title: 'Default', examCode: 'DEFAULT' }).rules.permittedFiles.toObject(), []);
    console.log('PASS: permitted file validation, persistence and empty backward-compatible default');
  } finally {
    Exam.findOne = oldFind; Exam.prototype.save = oldSave; audit.logTeacherAction = oldLog;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
