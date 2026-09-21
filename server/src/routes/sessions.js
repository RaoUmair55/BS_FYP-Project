const express = require('express');
const fs = require('fs');
const path = require('path');
const Session = require('../models/Session');
const { calculateRiskScore } = require('../scoring/severityEngine');
const router = express.Router();

const Exam = require('../models/Exam');
const { requireAuth } = require('../middleware/authMiddleware');
const storageService = require('../services/storage');

// GET /sessions/active (Teacher-facing)
router.get('/active', requireAuth, async (req, res) => {
    try {
        const activeSessions = await Session.find({ status: "active" });
        
        // Calculate the current risk score for each active session on load
        const sessionsWithScores = await Promise.all(activeSessions.map(async (session) => {
            const scoreData = await calculateRiskScore(session._id);
            return {
                ...session.toObject(),
                riskScore: scoreData.riskScore
            };
        }));
        
        res.json(sessionsWithScores);
    } catch (err) {
        console.error('Error fetching active sessions:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /sessions
router.post('/', async (req, res) => {
    try {
        const { studentName, rollNumber, examId, studentId, consentGiven, consentTimestamp } = req.body;
        
        if (!studentName || !studentName.trim()) {
            return res.status(400).json({ error: 'Student Name is required.' });
        }
        if (!rollNumber || !rollNumber.trim()) {
            return res.status(400).json({ error: 'Roll Number is required.' });
        }
        if (!examId || !examId.trim()) {
            return res.status(400).json({ error: 'Exam Code is required.' });
        }

        const inputCode = examId.trim().toUpperCase();
        const trimmedName = studentName.trim();
        const trimmedRoll = rollNumber.trim();
        const finalStudentId = (studentId && studentId.trim()) || trimmedRoll;

        // Validate against real Exam documents if any exist
        const examCount = await Exam.countDocuments();
        if (examCount > 0) {
            const exam = await Exam.findOne({
                $or: [
                    { examCode: new RegExp('^' + inputCode + '$', 'i') },
                    { examId: new RegExp('^' + inputCode + '$', 'i') }
                ]
            });

            if (!exam) {
                return res.status(400).json({ 
                    error: `Exam code "${inputCode}" does not exist. Please check your code.` 
                });
            }

            const currentStatus = (exam.status || 'active').toLowerCase();
            if (currentStatus !== 'active') {
                return res.status(400).json({ 
                    error: `Exam "${exam.title || exam.examCode || exam.examId}" (${inputCode}) is currently ${currentStatus.toUpperCase()} and not accepting candidates.` 
                });
            }
        }

        const newSession = new Session({
            studentId: finalStudentId,
            studentName: trimmedName,
            rollNumber: trimmedRoll,
            examId: inputCode,
            consentGiven: consentGiven === true || consentGiven === 'true',
            consentTimestamp: consentTimestamp ? new Date(consentTimestamp) : (consentGiven ? new Date() : null)
        });
        const savedSession = await newSession.save();
        res.status(201).json(savedSession);
    } catch (err) {
        console.error('Error creating session:', err);
        res.status(400).json({ error: 'Failed to create session', details: err.message });
    }
});

// PATCH /sessions/:sessionId/end
router.patch('/:sessionId/end', async (req, res) => {
    try {
        const session = await Session.findByIdAndUpdate(
            req.params.sessionId,
            { status: 'completed', endTime: new Date() },
            { new: true }
        );
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    } catch (err) {
        console.error('Error ending session:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /sessions/:sessionId/consent — Record candidate consent decision (Data Ethics Section 10.4)
router.post('/:sessionId/consent', async (req, res) => {
    try {
        const { consentGiven } = req.body;
        const session = await Session.findByIdAndUpdate(
            req.params.sessionId,
            {
                consentGiven: consentGiven === true || consentGiven === 'true',
                consentTimestamp: new Date()
            },
            { new: true }
        );

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            message: 'Consent recorded successfully',
            consentGiven: session.consentGiven,
            consentTimestamp: session.consentTimestamp
        });
    } catch (err) {
        console.error('Error recording consent:', err);
        res.status(500).json({ error: 'Failed to record consent', details: err.message });
    }
});

// POST /sessions/:sessionId/camera-verification — Upload initial camera verification photo
router.post('/:sessionId/camera-verification', async (req, res) => {
    try {
        const { photoBase64 } = req.body;
        if (!photoBase64) {
            return res.status(400).json({ error: 'photoBase64 is required' });
        }

        const filename = `${req.params.sessionId}_camera_check_${Date.now()}.jpg`;
        const saved = await storageService.save(photoBase64, filename, 'verification');
        const photoUrl = saved.url;

        const session = await Session.findByIdAndUpdate(
            req.params.sessionId,
            {
                cameraVerificationPhoto: photoUrl,
                cameraVerificationStatus: 'pending'
            },
            { new: true }
        );

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const io = req.app.locals.io;
        if (io) {
            io.emit('cameraVerificationUpdated', {
                sessionId: session._id.toString(),
                cameraVerificationPhoto: photoUrl,
                cameraVerificationStatus: 'pending'
            });
        }

        res.json({ message: 'Camera verification photo uploaded successfully', session });
    } catch (err) {
        console.error('Error saving camera verification photo:', err);
        res.status(500).json({ error: 'Failed to save camera verification photo' });
    }
});

// PATCH /sessions/:sessionId/camera-verification — Teacher triage (verified vs flagged)
router.patch('/:sessionId/camera-verification', requireAuth, async (req, res) => {
    try {
        const { status, note } = req.body;
        if (!['verified', 'flagged'].includes(status)) {
            return res.status(400).json({ error: 'Status must be verified or flagged' });
        }

        const session = await Session.findById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        session.cameraVerificationStatus = status;
        if (note) session.cameraVerificationNote = note;
        await session.save();

        const io = req.app.locals.io;

        // If flagged as issue, automatically convert to a violation record in student evidence timeline
        if (status === 'flagged') {
            const Violation = require('../models/Violation');
            const violationData = {
                sessionId: session._id.toString(),
                type: 'camera_issue',
                severity: 4,
                timestamp: new Date(),
                details: {
                    reason: note || 'Camera verification issue reported by examiner (covered/invalid feed)'
                },
                screenshotPath: session.cameraVerificationPhoto,
                reviewed: true,
                decision: 'confirmed',
                reviewNote: note || 'Teacher flagged initial camera check issue',
                reviewedAt: new Date()
            };

            const newViolation = new Violation(violationData);
            const savedViolation = await newViolation.save();

            const scoreData = await calculateRiskScore(session._id);

            if (io) {
                const { broadcastViolation, broadcastRiskScoreUpdate } = require('../sockets/violationSocket');
                broadcastViolation(io, savedViolation);
                broadcastRiskScoreUpdate(io, session._id.toString(), scoreData.riskScore);
            }
        }

        if (io) {
            io.emit('cameraVerificationUpdated', {
                sessionId: session._id.toString(),
                cameraVerificationPhoto: session.cameraVerificationPhoto,
                cameraVerificationStatus: status,
                cameraVerificationNote: note
            });
        }

        res.json({ message: `Camera verification status updated to ${status}`, session });
    } catch (err) {
        console.error('Error updating camera verification:', err);
        res.status(500).json({ error: 'Failed to update camera verification' });
    }
});

// GET /sessions/:sessionId/status — Candidate app status & warnings check
router.get('/:sessionId/status', async (req, res) => {
    try {
        const session = await Session.findById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({
            sessionId: session._id,
            studentId: session.studentId,
            studentName: session.studentName || session.studentId,
            rollNumber: session.rollNumber || session.studentId,
            examId: session.examId,
            status: session.status,
            terminationReason: session.terminationReason,
            warnings: session.warnings || [],
            cameraVerificationStatus: session.cameraVerificationStatus,
            cameraVerificationPhoto: session.cameraVerificationPhoto,
            cameraVerificationNote: session.cameraVerificationNote
        });
    } catch (err) {
        console.error('Error fetching session status:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /sessions/:sessionId/warn — Send examiner warning message to candidate (Teacher-facing)
router.post('/:sessionId/warn', requireAuth, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Warning message is required' });
        }

        const session = await Session.findById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const newWarning = {
            message: message.trim(),
            timestamp: new Date()
        };

        session.warnings.push(newWarning);
        await session.save();

        const io = req.app.locals.io;
        if (io) {
            io.emit('candidateWarning', {
                sessionId: session._id.toString(),
                studentId: session.studentId,
                examId: session.examId,
                warning: newWarning
            });
        }

        res.json({ message: 'Warning sent to candidate successfully', session });
    } catch (err) {
        console.error('Error sending warning to candidate:', err);
        res.status(500).json({ error: 'Failed to send warning' });
    }
});

// POST /sessions/:sessionId/terminate — Examiner terminates candidate session (Teacher-facing)
router.post('/:sessionId/terminate', requireAuth, async (req, res) => {
    try {
        const { reason } = req.body;
        const session = await Session.findById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        session.status = 'terminated';
        session.endTime = new Date();
        session.terminationReason = reason || 'Terminated by examiner for integrity violation';
        await session.save();

        const io = req.app.locals.io;
        if (io) {
            io.emit('candidateTerminated', {
                sessionId: session._id.toString(),
                studentId: session.studentId,
                examId: session.examId,
                reason: session.terminationReason
            });

            // Also broadcast risk update to refresh student list across dashboards
            const { calculateRiskScore } = require('../scoring/severityEngine');
            const { broadcastRiskScoreUpdate } = require('../sockets/violationSocket');
            const scoreData = await calculateRiskScore(session._id);
            broadcastRiskScoreUpdate(io, session._id.toString(), scoreData.riskScore);
        }

        res.json({ message: 'Candidate session terminated successfully', session });
    } catch (err) {
        console.error('Error terminating session:', err);
        res.status(500).json({ error: 'Failed to terminate session' });
    }
});

module.exports = router;
