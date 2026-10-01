const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Violation = require('../models/Violation');
const Session = require('../models/Session');
const Exam = require('../models/Exam');
const { broadcastViolation, broadcastRiskScoreUpdate, broadcastViolationReview } = require('../sockets/violationSocket');
const { calculateRiskScore } = require('../scoring/severityEngine');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireOwnedSession, requireOwnedViolation } = require('../middleware/examAccess');
const storageService = require('../services/storage');
const { broadcastToExam } = require('../sockets/violationSocket');
const multer = require('multer');

// Configure multer for screenshot and audio evidence uploads using memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const uploadFields = upload.fields([
    { name: 'screenshot', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]);

const router = express.Router();

// POST /violation — Machine-to-machine (Candidate App -> Server, intentionally open)
router.post('/violation', uploadFields, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.body.sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
        const session = await Session.findById(req.body.sessionId);
        if (!session) return res.status(404).json({ error: 'Exam session not found' });
        
        // If session was already terminated or completed, acknowledge gracefully so client buffer doesn't loop
        if (session.status !== 'active') {
            return res.status(200).json({ message: 'Session is no longer active', status: session.status, terminated: true });
        }
        const numericSeverity = Number(req.body.severity);
        if (!Number.isInteger(numericSeverity) || numericSeverity < 1 || numericSeverity > 5) return res.status(400).json({ error: 'Invalid severity' });
        if (typeof req.body.type !== 'string' || !Violation.schema.path('type').enumValues.includes(req.body.type)) return res.status(400).json({ error: 'Invalid violation type' });
        let details = req.body.details;
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (e) {}
        }
        
        let screenshotPath = null;
        let audioPath = null;

        // Process screenshot file if provided
        const screenshotFile = (req.files && req.files['screenshot'] && req.files['screenshot'][0]) || req.file;
        if (screenshotFile && screenshotFile.fieldname === 'screenshot') {
            try {
                const uniqueFilename = `screenshot-${Date.now()}-${screenshotFile.originalname || 'snapshot.jpg'}`;
                const saved = await storageService.save(screenshotFile.buffer, uniqueFilename, 'screenshots');
                screenshotPath = saved.url;
            } catch (uploadErr) {
                console.error('[Violations Route] Failed to upload screenshot to storage service:', uploadErr);
            }
        }

        // Process audio evidence file if provided
        const audioFile = req.files && req.files['audio'] && req.files['audio'][0];
        if (audioFile) {
            try {
                const uniqueAudioFilename = `voice-${Date.now()}-${audioFile.originalname || 'voice_clip.wav'}`;
                const savedAudio = await storageService.save(audioFile.buffer, uniqueAudioFilename, 'audio_clips');
                audioPath = savedAudio.url;
            } catch (audioErr) {
                console.error('[Violations Route] Failed to upload audio clip to storage service:', audioErr);
            }
        }
        
        const severity = numericSeverity;
        
        const newViolation = new Violation({
            sessionId: req.body.sessionId,
            type: req.body.type,
            severity: severity,
            timestamp: req.body.timestamp || new Date(),
            details: details,
            screenshotPath: screenshotPath,
            audioPath: audioPath,
            reviewed: false,
            decision: "pending"
        });

        if (mongoose.connection.readyState !== 1) {
            console.warn('[WARNING] MongoDB unreachable. Writing violation to local fallback.');
            const fallbackFilename = `violation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
            await storageService.save(JSON.stringify(newViolation.toObject(), null, 2), fallbackFilename, 'failed-violations');
            
            const io = req.app.locals.io;
            broadcastViolation(io, newViolation);
            return res.status(200).json({ message: "Saved locally (MongoDB unreachable)", fallback: true });
        }

        const savedViolation = await newViolation.save();
        const io = req.app.locals.io;
        if (session.status === 'active') {
            broadcastViolation(io, { ...savedViolation.toObject(), examId: session.examId });
        }

        try {
            const scoreData = await calculateRiskScore(savedViolation.sessionId);
            broadcastRiskScoreUpdate(io, savedViolation.sessionId, scoreData.riskScore);
        } catch (scoreErr) {
            console.error('Failed to update and broadcast risk score:', scoreErr);
        }

        res.status(201).json(savedViolation);
    } catch (err) {
        console.error('Error saving violation:', err);
        res.status(400).json({ error: 'Invalid data', details: err.message });
    }
});

// GET /violations — Get all violations (Teacher-facing, protected)
router.get('/violations', requireAuth, async (req, res) => {
    try {
        const query = {};
        const activeOnly = req.query.active === 'true';
        if (req.query.reviewed !== undefined) {
            query.reviewed = req.query.reviewed === 'true';
        }

        const currentTeacherId = req.teacher?.teacherId ? String(req.teacher.teacherId) : null;
        const isAdmin = req.teacher?.role === 'admin';

        // Enforce teacher isolation: only return violations from exams owned by this teacher
        let myCodes = null;
        if (!isAdmin && currentTeacherId) {
            const myExams = await Exam.find({ createdBy: currentTeacherId }).select('examCode examId _id').lean();
            myCodes = [];
            myExams.forEach(e => {
                if (e.examCode) myCodes.push(new RegExp('^' + e.examCode + '$', 'i'));
                if (e.examId) myCodes.push(new RegExp('^' + e.examId + '$', 'i'));
                if (e._id) myCodes.push(e._id.toString());
            });

            if (myCodes.length === 0) {
                return res.json([]);
            }

            if (!activeOnly) {
                const mySessions = await Session.find({ examId: { $in: myCodes } }).select('_id sessionId studentId').lean();
                const mySessionIds = [];
                mySessions.forEach(s => {
                    mySessionIds.push(String(s._id));
                    if (s.sessionId) mySessionIds.push(String(s.sessionId));
                    if (s.studentId) mySessionIds.push(String(s.studentId));
                });

                if (mySessionIds.length === 0) {
                    return res.json([]);
                }
                query.sessionId = { $in: mySessionIds };
            }
        }

        let sessionById = null;
        if (activeOnly) {
            const sessionFilter = { status: 'active' };
            if (myCodes) sessionFilter.examId = { $in: myCodes };
            const activeSessions = await Session.find(sessionFilter).select('_id sessionId studentId examId').lean();
            const activeSessionIds = [];
            sessionById = new Map();
            activeSessions.forEach(session => {
                [session._id, session.sessionId, session.studentId].filter(Boolean).forEach(id => {
                    const key = String(id);
                    activeSessionIds.push(key);
                    sessionById.set(key, session);
                });
            });
            if (activeSessionIds.length === 0) return res.json([]);
            query.sessionId = { $in: activeSessionIds };
        }

        const violations = await Violation.find(query).sort({ timestamp: -1 });
        const result = activeOnly ? violations.map(violation => ({
            ...violation.toObject(),
            examId: sessionById.get(String(violation.sessionId))?.examId || null
        })) : violations;
        res.json(result);
    } catch (err) {
        console.error('Error fetching all violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /violations/priority-queue — Priority Queue for Cross-Student Unreviewed Violations (Teacher-facing, protected)
router.get('/violations/priority-queue', requireAuth, async (req, res) => {
    try {
        const { autoExpireFinishedExams } = require('../utils/examLifecycle');
        await autoExpireFinishedExams(req.app.locals.io);

        const currentTeacherId = req.teacher?.teacherId ? String(req.teacher.teacherId) : null;
        const isAdmin = req.teacher?.role === 'admin';

        // Find currently active exams (scoped by teacher RBAC)
        const activeExamFilter = { status: 'active' };
        if (!isAdmin && currentTeacherId) {
            activeExamFilter.$or = [
                { createdBy: currentTeacherId },
                { status: 'active' }
            ];
        }

        const activeExams = await Exam.find(activeExamFilter).select('examCode examId _id').lean();
        const activeExamCodes = [];
        activeExams.forEach(e => {
            if (e.examCode) activeExamCodes.push(new RegExp('^' + e.examCode + '$', 'i'));
            if (e.examId) activeExamCodes.push(new RegExp('^' + e.examId + '$', 'i'));
        });

        // If no exams are active, return empty priority queue immediately
        if (activeExamCodes.length === 0) {
            return res.json([]);
        }

        // Include sessions from currently active exams
        const statusCondition = {
            $or: [
                { status: 'active' },
                { 
                    status: { $in: ['terminated', 'completed'] }, 
                    startTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
                }
            ]
        };

        const sessionFilter = { 
            ...statusCondition,
            examId: { $in: activeExamCodes }
        };

        if (req.query.examId) {
            const requestedCode = req.query.examId.trim();
            const matchesActive = activeExamCodes.some(r => r.test(requestedCode));
            if (!matchesActive) {
                return res.json([]);
            }
            sessionFilter.examId = new RegExp('^' + requestedCode + '$', 'i');
        }

        // 1. Fetch relevant sessions (scoped to active exams and optional examId filter)
        const activeSessions = await Session.find(sessionFilter).lean();
        
        if (activeSessions.length === 0) {
            return res.json([]);
        }

        const activeSessionMap = new Map();
        activeSessions.forEach(s => {
            activeSessionMap.set(String(s._id), s);
            if (s.studentId) activeSessionMap.set(String(s.studentId), s);
        });

        const activeSessionIds = Array.from(activeSessionMap.keys());
        
        let violationQuery = { 
            reviewed: { $ne: true },
            sessionId: { $in: activeSessionIds }
        };

        // 2. Fetch unreviewed violations sorted by severity descending, then timestamp descending
        const rawViolations = await Violation.find(violationQuery)
            .sort({ severity: -1, timestamp: -1 })
            .lean();

        // 3. Fallback lookup for any session IDs not cached
        const missingSessionIds = rawViolations
            .map(v => String(v.sessionId))
            .filter(id => !activeSessionMap.has(id));

        if (missingSessionIds.length > 0) {
            const validObjectIds = missingSessionIds.filter(id => mongoose.Types.ObjectId.isValid(id));
            const extraSessions = await Session.find({
                $or: [
                    { _id: { $in: validObjectIds } },
                    { studentId: { $in: missingSessionIds } }
                ]
            }).lean();
            extraSessions.forEach(s => {
                activeSessionMap.set(String(s._id), s);
                if (s.studentId) activeSessionMap.set(String(s.studentId), s);
            });
        }

        // 4. Enrich with student details for immediate display
        const enrichedViolations = rawViolations.map(v => {
            const session = activeSessionMap.get(String(v.sessionId));
            return {
                ...v,
                studentName: session?.studentName || 'Candidate',
                rollNumber: session?.rollNumber || 'N/A',
                examId: session?.examId || 'Unknown'
            };
        });

        res.json(enrichedViolations);
    } catch (err) {
        console.error('Error fetching priority queue violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /violations/:sessionId — Get violations for specific session (Teacher-facing, protected)
router.get('/violations/:sessionId', requireAuth, requireOwnedSession, async (req, res) => {
    try {
        const query = { sessionId: req.params.sessionId };
        if (req.query.reviewed !== undefined) {
            query.reviewed = req.query.reviewed === 'true';
        }
        const violations = await Violation.find(query).sort({ timestamp: -1 });
        res.json(violations);
    } catch (err) {
        console.error('Error fetching session violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH /violations/:violationId/review — Review a violation (Teacher-facing, protected)
router.patch('/violations/:violationId/review', requireAuth, requireOwnedViolation, async (req, res) => {
    try {
        const { reviewed, reviewNote, decision } = req.body;
        
        if (!['confirmed', 'dismissed', 'pending'].includes(decision)) {
            return res.status(400).json({ error: 'Invalid decision. Must be confirmed, dismissed, or pending.' });
        }

        const updateData = {
            reviewed: reviewed !== undefined ? Boolean(reviewed) : true,
            decision: decision,
            reviewNote: reviewNote !== undefined ? String(reviewNote) : "",
            reviewedAt: new Date()
        };

        const updatedViolation = await Violation.findByIdAndUpdate(
            req.params.violationId,
            updateData,
            { new: true }
        );

        if (!updatedViolation) {
            return res.status(404).json({ error: 'Violation not found' });
        }

        const io = req.app.locals.io;
        
        // Broadcast violation review event live over WebSockets
        broadcastViolationReview(io, {
            violationId: updatedViolation._id,
            sessionId: updatedViolation.sessionId,
            reviewed: updatedViolation.reviewed,
            decision: updatedViolation.decision,
            reviewNote: updatedViolation.reviewNote,
            reviewedAt: updatedViolation.reviewedAt,
            violationDoc: updatedViolation
        });

        // Recalculate & broadcast risk score
        try {
            const scoreData = await calculateRiskScore(updatedViolation.sessionId);
            broadcastRiskScoreUpdate(io, updatedViolation.sessionId, scoreData.riskScore);
        } catch (scoreErr) {
            console.error('Failed to recalculate risk score:', scoreErr);
        }

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'VIOLATION_REVIEWED',
            targetType: 'violation',
            targetId: updatedViolation._id,
            targetSummary: `Reviewed violation [${updatedViolation.type}]: Decision = ${decision.toUpperCase()}${reviewNote ? ` ("${reviewNote}")` : ''}`,
            details: {
                sessionId: updatedViolation.sessionId,
                violationType: updatedViolation.type,
                severity: updatedViolation.severity,
                decision,
                reviewNote
            }
        });

        res.json({
            message: 'Violation reviewed successfully',
            violation: updatedViolation
        });
    } catch (err) {
        console.error('Error reviewing violation:', err);
        res.status(500).json({ error: 'Failed to review violation', details: err.message });
    }
});

module.exports = router;
