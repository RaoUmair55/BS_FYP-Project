const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const { createHash, randomUUID } = require('node:crypto');
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

function eventWindowError(session, timestamp) {
    const start = new Date(session.startTime).getTime();
    const end = session.endTime ? new Date(session.endTime).getTime() : null;
    if (!Number.isFinite(start) || (end !== null && !Number.isFinite(end)) || (session.status !== 'active' && end === null)) {
        return { status: 503, error: 'Session evidence window unavailable; retry later' };
    }
    if (timestamp < start || (end !== null && timestamp > end)) {
        return { status: 400, error: 'Event timestamp is outside the session exam window' };
    }
    return null;
}

function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}

// POST /violation — Machine-to-machine (Candidate App -> Server, intentionally open)
router.post('/violation', uploadFields, async (req, res) => {
    const uploadedAssets = [];
    let committed = false;
    try {
        // A failed database write must stay in the candidate's durable retry queue.
        if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: 'Database unavailable; retry later' });
        if (!mongoose.Types.ObjectId.isValid(req.body.sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
        let session = await Session.findById(req.body.sessionId);
        if (!session) return res.status(404).json({ error: 'Exam session not found' });
        const receivedAt = new Date();
        const rawTimestamp = req.body.timestamp ?? (session.status === 'active' ? receivedAt.toISOString() : null);
        if (typeof rawTimestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(rawTimestamp)) {
            return res.status(400).json({ error: 'A valid event timestamp with timezone is required' });
        }
        const timestamp = new Date(rawTimestamp);
        const [year, month, day] = rawTimestamp.slice(0, 10).split('-').map(Number);
        if (!Number.isFinite(timestamp.getTime()) || month < 1 || month > 12 || day < 1 ||
            day > new Date(Date.UTC(year, month, 0)).getUTCDate() || timestamp.getTime() > receivedAt.getTime() + 5000) {
            return res.status(400).json({ error: 'Invalid or future event timestamp' });
        }
        const numericSeverity = Number(req.body.severity);
        if (!Number.isInteger(numericSeverity) || numericSeverity < 1 || numericSeverity > 5) return res.status(400).json({ error: 'Invalid severity' });
        if (typeof req.body.type !== 'string' || !Violation.schema.path('type').enumValues.includes(req.body.type)) return res.status(400).json({ error: 'Invalid violation type' });
        let details = req.body.details;
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (e) { return res.status(400).json({ error: 'Invalid details JSON' }); }
        }
        if (details != null && (typeof details !== 'object' || Array.isArray(details))) return res.status(400).json({ error: 'Details must be an object' });
        if (req.body.eventId !== undefined && (typeof req.body.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.body.eventId))) {
            return res.status(400).json({ error: 'Invalid eventId' });
        }
        const sessionId = String(session._id);
        const deliveryFingerprint = createHash('sha256').update(stableJson({ sessionId, type: req.body.type,
            severity: numericSeverity, timestamp: timestamp.toISOString(), details: details || {} })).digest('hex');
        const eventId = req.body.eventId || deliveryFingerprint;
        // Reuse MongoDB's existing unique _id index: no new index/migration is needed for retry safety.
        const id = new mongoose.Types.ObjectId(createHash('sha256').update(sessionId + ':' + eventId).digest('hex').slice(0, 24));
        const sameEvent = violation => violation.type === req.body.type && violation.severity === numericSeverity &&
            new Date(violation.timestamp).getTime() === timestamp.getTime() &&
            (!violation.deliveryFingerprint || violation.deliveryFingerprint === deliveryFingerprint);
        const existing = await Violation.findById(id);
        if (existing) {
            if (!sameEvent(existing)) {
                return res.status(400).json({ error: 'eventId was already used for a different event' });
            }
            return res.status(200).json({ ...existing.toObject(), duplicate: true });
        }
        let windowError = eventWindowError(session, timestamp.getTime());
        if (windowError) return res.status(windowError.status).json({ error: windowError.error });
        const newViolation = new Violation({
            _id: id, eventId, deliveryFingerprint, sessionId, type: req.body.type, severity: numericSeverity, timestamp,
            receivedAt, receivedLate: session.status !== 'active' || Boolean(session.endTime && receivedAt > session.endTime), details,
            reviewed: false, decision: 'pending'
        });
        await newViolation.validate();

        // Process screenshot file if provided
        const screenshotFile = (req.files && req.files['screenshot'] && req.files['screenshot'][0]) || req.file;
        if (screenshotFile && screenshotFile.fieldname === 'screenshot') {
            const uniqueFilename = `screenshot-${randomUUID()}-${path.basename(screenshotFile.originalname || 'snapshot.jpg')}`;
            const saved = await storageService.save(screenshotFile.buffer, uniqueFilename, 'screenshots');
            uploadedAssets.push(saved.path || saved.url);
            newViolation.screenshotPath = saved.url;
        }

        // Process audio evidence file if provided
        const audioFile = req.files && req.files['audio'] && req.files['audio'][0];
        if (audioFile) {
            const uniqueAudioFilename = `voice-${randomUUID()}-${path.basename(audioFile.originalname || 'voice_clip.wav')}`;
            const savedAudio = await storageService.save(audioFile.buffer, uniqueAudioFilename, 'audio_clips');
            uploadedAssets.push(savedAudio.path || savedAudio.url);
            newViolation.audioPath = savedAudio.url;
        }
        // Re-check session window only if file uploads took wall-clock time
        if (uploadedAssets.length > 0) {
            session = await Session.findById(sessionId);
            if (!session) return res.status(404).json({ error: 'Exam session not found' });
            windowError = eventWindowError(session, timestamp.getTime());
            if (windowError) return res.status(windowError.status).json({ error: windowError.error });
            newViolation.receivedLate = session.status !== 'active' || Boolean(session.endTime && receivedAt > session.endTime);
        }

        let savedViolation;
        try {
            savedViolation = await newViolation.save();
        } catch (err) {
            if (err.code !== 11000) throw err;
            // Two retries may race; the unique _id lets only one commit.
            const duplicate = await Violation.findById(id);
            if (!duplicate) throw err;
            if (!sameEvent(duplicate)) return res.status(400).json({ error: 'eventId was already used for a different event' });
            return res.status(200).json({ ...duplicate.toObject(), duplicate: true });
        }
        committed = true;

        // Respond immediately to candidate with HTTP 201 so client connection is freed in milliseconds
        res.status(201).json(savedViolation);

        // Execute WebSocket broadcast and risk score update asynchronously in background
        if (!savedViolation.receivedLate) {
            setImmediate(async () => {
                try {
                    const io = req.app.locals.io;
                    if (io) {
                        broadcastViolation(io, { ...savedViolation.toObject(), examId: session.examId });
                        const scoreData = await calculateRiskScore(savedViolation.sessionId);
                        broadcastRiskScoreUpdate(io, savedViolation.sessionId, scoreData.riskScore);
                    }
                } catch (bgErr) {
                    console.error('[Violation Pipeline] Background risk calculation / broadcast error:', bgErr);
                }
            });
        }
    } catch (err) {
        console.error('Error saving violation:', err);
        if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: 'Invalid event data' });
        res.status(503).json({ error: 'Evidence could not be saved; retry later' });
    } finally {
        if (!committed) {
            await Promise.allSettled(uploadedAssets.map(asset => storageService.delete(asset)));
        }
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
        if (!isAdmin) {
            if (!currentTeacherId) return res.json([]);
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
                const mySessions = await Session.find({ examId: { $in: myCodes } }).select('_id').lean();
                const mySessionIds = [];
                mySessions.forEach(s => {
                    mySessionIds.push(String(s._id));
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
            const activeSessions = await Session.find(sessionFilter).select('_id examId').lean();
            const activeSessionIds = [];
            sessionById = new Map();
            activeSessions.forEach(session => {
                [session._id].forEach(id => {
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
        if (!isAdmin) {
            if (!currentTeacherId) return res.json([]);
            activeExamFilter.createdBy = currentTeacherId;
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
