const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const Submission = require('../models/Submission');
const { calculateRiskScore } = require('../scoring/severityEngine');
const { requireAuth } = require('../middleware/authMiddleware');
const storageService = require('../services/storage');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || 
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.mimetype === 'application/msword') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF and DOCX files are allowed.'));
        }
    }
});

function handleUpload(req, res, next) {
    upload.single('paper')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}

function generateRandomExamCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `EXAM-${code}`;
}

// POST /exams — Create a new exam (Teacher-facing)
router.post('/', requireAuth, handleUpload, async (req, res) => {
    try {
        const { title, status, durationMinutes, rules } = req.body;
        let examCode = req.body.examCode ? req.body.examCode.trim().toUpperCase() : null;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Exam title is required.' });
        }

        if (!examCode) {
            examCode = generateRandomExamCode();
        }

        // Check if code already exists
        const existing = await Exam.findOne({ examCode });
        if (existing) {
            return res.status(400).json({ error: `Exam code "${examCode}" already exists. Please choose a different code.` });
        }

        let parsedRules = {};
        if (rules) {
            try {
                parsedRules = typeof rules === 'string' ? JSON.parse(rules) : rules;
            } catch (e) {
                parsedRules = rules;
            }
        }

        let paperPath = null;
        let paperFilename = null;
        if (req.file) {
            const uniqueFilename = `${examCode.replace(/[^a-zA-Z0-9-]/g, '')}-${Date.now()}${path.extname(req.file.originalname)}`;
            const saved = await storageService.save(req.file.buffer, uniqueFilename, 'papers');
            paperPath = saved.path;
            paperFilename = req.file.originalname;
        }

        const teacherId = req.teacher?.teacherId || null;
        const teacherName = req.teacher?.name || req.teacher?.email || 'Examiner';

        const examData = {
            title: title.trim(),
            examCode,
            examId: examCode,
            createdBy: teacherId,
            createdByName: teacherName,
            status: status || 'draft',
            durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
            rules: {
                detectCellPhone: parsedRules.detectCellPhone !== undefined ? Boolean(parsedRules.detectCellPhone) : true,
                detectMultiplePersons: parsedRules.detectMultiplePersons !== undefined ? Boolean(parsedRules.detectMultiplePersons) : true,
                enforceAppWhitelist: parsedRules.enforceAppWhitelist !== undefined ? Boolean(parsedRules.enforceAppWhitelist) : true,
                detectLookingAway: parsedRules.detectLookingAway !== undefined ? Boolean(parsedRules.detectLookingAway) : true,
                autoTerminateRiskScore: parsedRules.autoTerminateRiskScore !== undefined ? Number(parsedRules.autoTerminateRiskScore) : 80
            },
            paperPath,
            paperFilename,
            createdAt: new Date()
        };

        const newExam = new Exam(examData);
        const savedExam = await newExam.save();

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'EXAM_CREATED',
            targetType: 'exam',
            targetId: savedExam._id,
            targetSummary: `Created new Exam: "${savedExam.title}" (Code: ${savedExam.examCode})`,
            details: {
                examCode: savedExam.examCode,
                title: savedExam.title,
                durationMinutes: savedExam.durationMinutes,
                hasPaper: Boolean(savedExam.paperPath)
            }
        });

        res.status(201).json({
            message: 'Exam created successfully',
            exam: savedExam
        });
    } catch (err) {
        console.error('Error creating exam:', err);
        res.status(500).json({ error: 'Failed to create exam', details: err.message });
    }
});

// GET /exams — List exams sorted newest first (Teacher-facing)
router.get('/', requireAuth, async (req, res) => {
    try {
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status.toLowerCase();
        }
        if (req.query.scope === 'my' && req.teacher?.teacherId) {
            filter.createdBy = req.teacher.teacherId;
        }

        const exams = await Exam.find(filter).sort({ createdAt: -1 });
        
        // Enrich exams with active student count and fallback title/code
        const currentTeacherId = req.teacher?.teacherId ? String(req.teacher.teacherId) : null;

        const enrichedExams = await Promise.all(exams.map(async (exam) => {
            const code = exam.examCode || exam.examId || 'EXAM';
            const activeStudents = await Session.countDocuments({ 
                examId: new RegExp('^' + code + '$', 'i'), 
                status: 'active' 
            });
            const isMine = currentTeacherId && exam.createdBy ? String(exam.createdBy) === currentTeacherId : false;

            return {
                ...exam.toObject(),
                examCode: code,
                title: exam.title || `Exam Session (${code})`,
                status: exam.status || 'draft',
                activeStudents,
                isMine
            };
        }));

        res.json(enrichedExams);
    } catch (err) {
        console.error('Error fetching exams:', err);
        res.status(500).json({ error: 'Failed to fetch exams' });
    }
});

// GET /exams/code/:code — Get exam by code
router.get('/code/:code', async (req, res) => {
    try {
        const examCode = req.params.code.trim().toUpperCase();
        const exam = await Exam.findOne({ examCode });
        if (!exam) {
            return res.status(404).json({ error: `Exam code "${examCode}" not found.` });
        }
        res.json(exam);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch exam details' });
    }
});

// GET /exams/:examId/summary — Aggregated analytics & session list for completed/any exam (Teacher-facing)
router.get('/:examId/summary', requireAuth, async (req, res) => {
    try {
        const examIdentifier = req.params.examId;
        let exam = null;
        
        if (examIdentifier.match(/^[0-9a-fA-F]{24}$/)) {
            exam = await Exam.findById(examIdentifier);
        }
        if (!exam) {
            exam = await Exam.findOne({ 
                $or: [
                    { examCode: new RegExp('^' + examIdentifier + '$', 'i') },
                    { examId: new RegExp('^' + examIdentifier + '$', 'i') }
                ] 
            });
        }

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        const code = exam.examCode || exam.examId;
        const sessions = await Session.find({
            $or: [
                { examId: new RegExp('^' + code + '$', 'i') },
                { examId: exam._id.toString() }
            ]
        }).sort({ startTime: -1 });

        const sessionSummaries = await Promise.all(sessions.map(async (session) => {
            const scoreData = await calculateRiskScore(session._id);
            const submission = await Submission.findOne({ sessionId: session._id.toString() });

            return {
                sessionId: session._id,
                studentId: session.studentId,
                studentName: session.studentName || session.studentId,
                rollNumber: session.rollNumber || session.studentId,
                examId: session.examId,
                status: session.status,
                startTime: session.startTime,
                endTime: session.endTime,
                finalRiskScore: scoreData.riskScore,
                violationCount: scoreData.violationCount,
                submitted: !!submission,
                submissionStatus: submission ? 'Submitted' : 'Not Submitted',
                submissionType: submission ? submission.submissionType : null,
                submittedAt: submission ? submission.uploadedAt : null
            };
        }));

        const totalStudents = sessionSummaries.length;
        const totalViolations = sessionSummaries.reduce((sum, s) => sum + s.violationCount, 0);
        const avgRiskScore = totalStudents > 0 
            ? Math.round(sessionSummaries.reduce((sum, s) => sum + s.finalRiskScore, 0) / totalStudents) 
            : 0;

        // Calculate risk score distribution
        const riskDistribution = { high: 0, moderate: 0, low: 0 };
        sessionSummaries.forEach(s => {
            if (s.finalRiskScore >= 60) riskDistribution.high++;
            else if (s.finalRiskScore >= 30) riskDistribution.moderate++;
            else riskDistribution.low++;
        });

        // Calculate violation type breakdown
        const sessionIds = sessions.map(s => s._id.toString());
        const Violation = require('../models/Violation');
        const violations = await Violation.find({ sessionId: { $in: sessionIds } });

        const violationBreakdown = {};
        violations.forEach(v => {
            const key = v.type || 'other';
            violationBreakdown[key] = (violationBreakdown[key] || 0) + 1;
        });

        res.json({
            exam,
            totalStudents,
            totalViolations,
            avgRiskScore,
            riskDistribution,
            violationBreakdown,
            sessions: sessionSummaries
        });
    } catch (err) {
        console.error('Error fetching exam summary:', err);
        res.status(500).json({ error: 'Failed to fetch exam summary', details: err.message });
    }
});

// GET /exams/:examId — Get single exam details (Teacher-facing)
router.get('/:examId', requireAuth, async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.examId);
        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }
        res.json(exam);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch exam details' });
    }
});

// PATCH /exams/:examId/status — Update status (Teacher-facing)
router.patch('/:examId/status', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['draft', 'active', 'completed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value. Must be draft, active, or completed.' });
        }

        const exam = await Exam.findByIdAndUpdate(
            req.params.examId,
            { status },
            { new: true }
        );

        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        // If exam is completed, close out any remaining active student sessions for this exam
        if (status === 'completed') {
            const code = exam.examCode || exam.examId;
            await Session.updateMany(
                { 
                    examId: new RegExp('^' + code + '$', 'i'), 
                    status: 'active' 
                },
                { 
                    status: 'completed', 
                    endTime: new Date() 
                }
            );
        }

        res.json({ message: 'Exam status updated', exam });
    } catch (err) {
        console.error('Error updating exam status:', err);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// POST /exams/:examId/paper — Attach / update question paper (Teacher-facing)
router.post('/:examId/paper', requireAuth, handleUpload, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No paper file uploaded.' });
        }

        const exam = await Exam.findById(req.params.examId);
        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        // Delete previous paper if exists
        if (exam.paperPath) {
            await storageService.delete(exam.paperPath);
        }

        const uniqueFilename = `${(exam.examCode || req.params.examId).replace(/[^a-zA-Z0-9-]/g, '')}-${Date.now()}${path.extname(req.file.originalname)}`;
        const saved = await storageService.save(req.file.buffer, uniqueFilename, 'papers');

        exam.paperPath = saved.path;
        exam.paperFilename = req.file.originalname;
        await exam.save();

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'PAPER_UPDATED',
            targetType: 'exam',
            targetId: exam._id,
            targetSummary: `Updated Question Paper for Exam: "${exam.title}" (${exam.paperFilename})`,
            details: { examId: exam.examCode || exam._id, filename: exam.paperFilename, path: exam.paperPath }
        });

        res.json({ message: 'Question paper updated successfully', exam });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update exam paper' });
    }
});

// DELETE /exams/:examId — Delete an exam (Teacher-facing)
router.delete('/:examId', requireAuth, async (req, res) => {
    try {
        const exam = await Exam.findByIdAndDelete(req.params.examId);
        if (!exam) {
            return res.status(404).json({ error: 'Exam not found' });
        }

        // Delete paper file from storage if exists
        if (exam.paperPath) {
            await storageService.delete(exam.paperPath);
        }

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'EXAM_DELETED',
            targetType: 'exam',
            targetId: req.params.examId,
            targetSummary: `Deleted Exam: "${exam.title}" (Code: ${exam.examCode})`,
            details: { examCode: exam.examCode, title: exam.title }
        });

        res.json({ message: 'Exam deleted successfully', examId: req.params.examId });
    } catch (err) {
        console.error('Error deleting exam:', err);
        res.status(500).json({ error: 'Failed to delete exam', details: err.message });
    }
});

module.exports = router;
