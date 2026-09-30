const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Teacher = mongoose.model('Teacher', new mongoose.Schema({}, { strict: false }));
  const Session = mongoose.model('Session', new mongoose.Schema({}, { strict: false }));
  const Exam = mongoose.model('Exam', new mongoose.Schema({}, { strict: false }));

  const teachers = await Teacher.find({});
  console.log('TEACHERS:', teachers.map(t => ({ id: String(t._id), email: t.email, name: t.name, role: t.role })));

  const allSessions = await Session.find({});
  console.log('ALL SESSIONS COUNT:', allSessions.length);
  for (const s of allSessions) {
    console.log(`- Session: ${s._id} | student: ${s.studentName} (${s.rollNumber}) | examId: ${s.examId} | status: ${s.status} | start: ${s.startTime} | end: ${s.endTime}`);
  }

  const allExams = await Exam.find({});
  console.log('ALL EXAMS COUNT:', allExams.length);
  for (const e of allExams) {
    console.log(`- Exam: ${e._id} | code: ${e.examCode} | title: ${e.title} | status: ${e.status} | createdBy: ${e.createdBy} (${e.createdByName})`);
  }

  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
