const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const Violation = require('../models/Violation');

async function ownsExam(req, examId) {
    if (req.teacher.role === 'admin') return true;
    const query = mongoose.Types.ObjectId.isValid(examId)
        ? { $or: [{ _id: examId }, { examCode: examId }, { examId }] }
        : { $or: [{ examCode: examId }, { examId }] };
    return Boolean(await Exam.exists({ ...query, createdBy: req.teacher.teacherId }));
}

function requireExamAccess(getExamId) {
    return async (req, res, next) => {
        try {
            if (!await ownsExam(req, getExamId(req))) return res.status(404).json({ error: 'Exam not found' });
            next();
        } catch (err) { next(err); }
    };
}

const requireOwnedExam = requireExamAccess(req => req.params.examId);
const requireOwnedSession = async (req, res, next) => {
    try {
        const session = await Session.findById(req.params.sessionId);
        if (!session || !await ownsExam(req, session.examId)) return res.status(404).json({ error: 'Session not found' });
        next();
    } catch (err) { next(err); }
};
const requireOwnedViolation = async (req, res, next) => {
    try {
        const violation = await Violation.findById(req.params.violationId);
        const session = violation && await Session.findById(violation.sessionId);
        if (!session || !await ownsExam(req, session.examId)) return res.status(404).json({ error: 'Violation not found' });
        next();
    } catch (err) { next(err); }
};

module.exports = { requireExamAccess, requireOwnedExam, requireOwnedSession, requireOwnedViolation, ownsExam };
