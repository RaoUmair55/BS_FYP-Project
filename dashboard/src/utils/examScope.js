const normalize = value => String(value || '').trim().toUpperCase();
export const matchesExam = (exam, identifier) => Boolean(identifier) && [exam._id, exam.examCode, exam.examId].some(value => normalize(value) === normalize(identifier));
export const scopedExams = (exams, filter) => exams.filter(exam => exam.status === 'active' && (!filter || matchesExam(exam, filter)));
export const scopedSessions = (sessions, exams, filter) => sessions.filter(session => scopedExams(exams, filter).some(exam => matchesExam(exam, session.examId)));
