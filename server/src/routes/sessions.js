const express = require('express');
const fs = require('fs');
const path = require('path');
const Session = require('../models/Session');
const { calculateRiskScore } = require('../scoring/severityEngine');
const router = express.Router();
const { nameSchema, rollNumberSchema, examCodeSchema } = require('../utils/inputValidation');

const Exam = require('../models/Exam');
const { randomUUID } = require('node:crypto');
const { createPhotoSchedule, nextPhotoRequest } = require('../utils/cameraPhotos');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireOwnedSession } = require('../middleware/examAccess');
const storageService = require('../services/storage');
const { broadcastToExam } = require('../sockets/violationSocket');

// GET /sessions/active (Teacher-facing)
router.get('/active', requireAuth, async (req, res) => {
    try {
        const { autoExpireFinishedExams } = require('../utils/examLifecycle');
        await autoExpireFinishedExams(req.app.locals.io);

        const currentTeacherId = req.teacher?.teacherId ? String(req.teacher.teacherId) : null;
        const isAdmin = req.teacher?.role === 'admin';

        // Find all currently active exams (scoped by teacher RBAC)
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

        // If no exams are active, return empty candidate roster immediately
        if (activeExamCodes.length === 0) {
            return res.json([]);
        }

        // Include candidates of active exams (active students or recently submitted/terminated within this active exam)
        const statusCondition = {
            $or: [
                { status: "active" },
                { 
                    status: { $in: ["terminated", "completed"] }, 
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

        const candidateSessions = await Session.find(sessionFilter).sort({ startTime: -1 });
        
        // Calculate the current risk score for each session on load
        const sessionsWithScores = await Promise.all(candidateSessions.map(async (session) => {
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
        
        if (!nameSchema.safeParse(studentName).success) {
            return res.status(400).json({ error: 'Student name must contain 2-100 characters and at least two letters; use letters, spaces, apostrophes, periods or hyphens.' });
        }
        if (!rollNumberSchema.safeParse(rollNumber).success) {
            return res.status(400).json({ error: 'Roll number must contain 2-35 characters and a letter or number; use letters, numbers, spaces, hyphens, underscores, periods or slashes.' });
        }
        if (!examCodeSchema.safeParse(examId).success) {
            return res.status(400).json({ error: 'Exam code must contain 3-32 letters, numbers or hyphens, including a letter or number.' });
        }
        if (consentGiven !== true && consentGiven !== 'true') return res.status(400).json({ error: 'Consent is required' });

        const inputCode = examId.trim().toUpperCase();
        const trimmedName = studentName.trim();
        const trimmedRoll = rollNumber.trim();
        if (studentId != null && !rollNumberSchema.safeParse(studentId).success) {
            return res.status(400).json({ error: 'Invalid student ID.' });
        }
        const finalStudentId = (studentId && studentId.trim()) || trimmedRoll;

        let examDuration = 60;
        let examEndTime = null;
        let examExtra = 0;

        // Candidates can only join an existing exam.
            const exam = await Exam.findOne({
                $or: [
                    { examCode: inputCode },
                    { examId: inputCode }
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

            examDuration = exam.durationMinutes || 60;
            examExtra = exam.extraMinutes || 0;

            // If exam has paper uploaded and paper is not yet released, exam is in Waiting Lobby
            if (exam.paperPath && exam.paperReleased === false) {
                examEndTime = null;
            } else if (exam.paperPath && exam.paperReleased === true) {
                // Lobby is closed: Question paper was already released by the examiner
                return res.status(403).json({
                    error: `Lobby is closed for "${inputCode}". The examiner has already released the question paper and late entry is not permitted.`
                });
            } else {
                // If exam has not yet officially stamped startedAt and no lobby is pending
                if (!exam.startedAt) {
                    exam.startedAt = new Date();
                    exam.endTime = new Date(Date.now() + (examDuration + examExtra) * 60 * 1000);
                    await exam.save();
                } else if (exam.endTime && new Date() >= new Date(exam.endTime)) {
                    return res.status(400).json({
                        error: `Exam time for "${inputCode}" has already ended. Submission window is closed.`
                    });
                }
                examEndTime = exam.endTime;
            }
        const newSession = new Session({
            studentId: finalStudentId,
            studentName: trimmedName,
            rollNumber: trimmedRoll,
            examId: inputCode,
            startTime: new Date(),
            endTime: examEndTime,
            extraMinutes: examExtra,
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

// POST /sessions/:sessionId/camera-verification — Upload initial camera verification photo
router.post('/:sessionId/camera-verification', async (req, res) => {
    try {
        const { photoBase64, requestId } = req.body;
        if (requestId != null && (typeof requestId !== 'string' || requestId.length > 100)) return res.status(400).json({ error: 'Invalid photo request ID' });
        if (typeof photoBase64 !== 'string' || photoBase64.length > 2_000_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photoBase64)) return res.status(400).json({ error: 'A JPEG photo under 1.5 MB is required' });
        const session = await Session.findById(req.params.sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const exam = await Exam.findOne({ $or: [{ examCode: session.examId }, { examId: session.examId }] });
        if (!exam || exam.status !== 'active' || session.status !== 'active' || (exam.endTime && new Date(exam.endTime) <= new Date())) return res.status(409).json({ error: 'Exam session is no longer active' });
        if (exam.examType === 'physical_lab') return res.status(400).json({ error: 'Camera checks are disabled for physical-lab exams' });
        const request = requestId && session.cameraPhotoRequests.find(r => r.id === requestId);
        if (requestId && !request) return res.status(400).json({ error: 'Unknown photo request' });
        if (request?.completedAt) return res.json({ message: 'Photo already received', session });
        if (request && new Date(request.dueAt) > new Date()) return res.status(409).json({ error: 'Photo request is not due yet' });
        if (session.cameraPhotos.length >= 50) return res.status(409).json({ error: 'Photo history limit reached' });
        const filename = `${session._id}_camera_check_${randomUUID()}.jpg`;
        const saved = await storageService.save(photoBase64, filename, 'verification');
        const photoUrl = saved.url;
        const photos = [];
        if (!session.cameraPhotos.length && session.cameraVerificationPhoto) photos.push({ url: session.cameraVerificationPhoto, source: 'initial', capturedAt: session.startTime, status: session.cameraVerificationStatus === 'verified' ? 'verified' : 'pending' });
        photos.push({ url: photoUrl, capturedAt: new Date(), source: request?.source || 'initial', requestId: requestId || null });
        const set = { cameraVerificationPhoto: photoUrl, cameraVerificationStatus: 'pending', cameraVerificationNote: null };
        if (request) set['cameraPhotoRequests.$[request].completedAt'] = new Date();
        const updated = await Session.findOneAndUpdate({ _id: session._id, ...(requestId ? { cameraPhotoRequests: { $elemMatch: { id: requestId, completedAt: null } } } : {}) },
            { $set: set, $push: { cameraPhotos: { $each: photos } } },
            { new: true, ...(request ? { arrayFilters: [{ 'request.id': requestId }] } : {}) });
        if (!updated) { await storageService.delete(photoUrl); return res.status(409).json({ error: 'Photo was already received. Refresh session state.' }); }
        const io = req.app.locals.io;
        if (io) {
            await broadcastToExam(io, session.examId, 'cameraVerificationUpdated', {
                sessionId: session._id.toString(),
                cameraVerificationPhoto: photoUrl,
                cameraVerificationStatus: 'pending'
            });
        }

        res.json({ message: 'Camera verification photo uploaded successfully', session: updated });
    } catch (err) {
        console.error('Error saving camera verification photo:', err);
        res.status(500).json({ error: 'Failed to save camera verification photo' });
    }
});

// A routine photo request never creates a violation or changes risk scores.
router.post('/:sessionId/request-camera-photo', requireAuth, requireOwnedSession, async (req, res) => {
    try {
        const note = req.body.note ?? '';
        if (typeof note !== 'string' || note.length > 500) return res.status(400).json({ error: 'Photo note must be under 500 characters' });
        const session = await Session.findById(req.params.sessionId);
        const exam = session && await Exam.findOne({ $or: [{ examCode: session.examId }, { examId: session.examId }] });
        if (!exam || exam.status !== 'active' || session.status !== 'active' || (exam.endTime && new Date(exam.endTime) <= new Date())) return res.status(409).json({ error: 'Exam session is no longer active' });
        if (exam.examType === 'physical_lab') return res.status(400).json({ error: 'Camera checks are disabled for physical-lab exams' });
        if (session.cameraPhotos.length >= 50) return res.status(409).json({ error: 'Photo history limit reached' });
        const request = { id: randomUUID(), source: 'requested', dueAt: new Date(), note: note.trim() };
        const updated = await Session.findOneAndUpdate({ _id: session._id, cameraPhotoRequests: { $not: { $elemMatch: { source: 'requested', completedAt: null } } } }, { $push: { cameraPhotoRequests: request } }, { new: true });
        if (!updated) return res.status(409).json({ error: 'A photo request is already pending' });
        await require('../utils/auditLogger').logTeacherAction(req, { action: 'CAMERA_PHOTO_REQUESTED', targetType: 'session', targetId: session._id, targetSummary: 'Requested a new identity photo', details: { requestId: request.id, note: request.note } });
        res.json({ message: 'Photo requested', session: updated });
    } catch (err) { console.error('Photo request failed:', err); res.status(500).json({ error: 'Unable to request a photo' }); }
});

// PATCH /sessions/:sessionId/camera-verification — Teacher triage (verified vs flagged)
router.patch('/:sessionId/camera-verification', requireAuth, requireOwnedSession, async (req, res) => {
    try {
        const { status, note, photoUrl, historyPhotoId } = req.body;
        if (note != null && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ error: 'Camera note must be under 500 characters' });
        if (!['verified', 'flagged'].includes(status)) {
            return res.status(400).json({ error: 'Status must be verified or flagged' });
        }

        const session = await Session.findById(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (status === 'verified') {
            if (!session.cameraVerificationPhoto) return res.status(400).json({ error: 'No photo to verify' });
            if (historyPhotoId) {
                const photo = session.cameraPhotos.find(item => String(item._id) === historyPhotoId);
                if (!photo || photo.url !== photoUrl) return res.status(404).json({ error: 'Photo not found in this session' });
                if (photo.url !== session.cameraVerificationPhoto) {
                    const updated = await Session.findOneAndUpdate({ _id: session._id, 'cameraPhotos._id': photo._id }, { $set: { 'cameraPhotos.$[photo].status': 'verified', 'cameraPhotos.$[photo].reviewedAt': new Date() } }, { new: true, arrayFilters: [{ 'photo._id': photo._id }] });
                    if (!updated) return res.status(404).json({ error: 'Photo no longer exists' });
                    await require('../utils/auditLogger').logTeacherAction(req, { action: 'VERIFICATION_REVIEWED', targetType: 'session', targetId: session._id, targetSummary: 'Historical identity photo verified', details: { photoId: historyPhotoId } });
                    return res.json({ message: 'Historical identity photo verified', session: updated });
                }
            }
            if (photoUrl && photoUrl !== session.cameraVerificationPhoto) return res.status(409).json({ error: 'A newer photo has arrived. Review it before confirming.' });
            const set = { cameraVerificationStatus: 'verified', cameraVerificationNote: null };
            const hasHistory = session.cameraPhotos.some(photo => photo.url === session.cameraVerificationPhoto);
            if (hasHistory) { set['cameraPhotos.$[photo].status'] = 'verified'; set['cameraPhotos.$[photo].reviewedAt'] = new Date(); }
            const updated = await Session.findOneAndUpdate({ _id: session._id, cameraVerificationPhoto: session.cameraVerificationPhoto }, { $set: set }, { new: true, ...(hasHistory ? { arrayFilters: [{ 'photo.url': session.cameraVerificationPhoto }] } : {}) });
            if (!updated) return res.status(409).json({ error: 'A newer photo has arrived. Refresh and review it.' });
            session.cameraVerificationStatus = updated.cameraVerificationStatus;
            session.cameraPhotos = updated.cameraPhotos;
            session.cameraVerificationNote = null;
        } else {
            session.cameraVerificationStatus = status;
            if (note) session.cameraVerificationNote = note;
            await session.save();
        }

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
            await broadcastToExam(io, session.examId, 'cameraVerificationUpdated', {
                sessionId: session._id.toString(),
                cameraVerificationPhoto: session.cameraVerificationPhoto,
                cameraVerificationStatus: status,
                cameraVerificationNote: note
            });
        }

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'VERIFICATION_REVIEWED',
            targetType: 'session',
            targetId: session._id,
            targetSummary: `Camera Verification Review: Candidate ${session.studentName || session.studentId} marked as ${status.toUpperCase()}${note ? ` ("${note}")` : ''}`,
            details: {
                sessionId: session._id,
                examId: session.examId,
                status,
                note
            }
        });

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

        let examEndTime = session.endTime;
        let examExtra = session.extraMinutes || 0;
        let durationMinutes = 60;
        let exam = null;

        if (session.examId) {
            exam = await Exam.findOne({
                $or: [
                    { examCode: session.examId },
                    { examId: session.examId }
                ]
            });
            if (exam) {
                durationMinutes = exam.durationMinutes || 60;
                examExtra = exam.extraMinutes || 0;
                if (exam.endTime) {
                    examEndTime = exam.endTime;
                }
            }
        }

        if (exam?.examType !== 'physical_lab' && exam?.status === 'active' && session.status === 'active' && exam.startedAt && !session.photoScheduleCreated && session.consentGiven) {
            const requests = createPhotoSchedule(Date.now(), new Date(examEndTime).getTime());
            const updated = await Session.findOneAndUpdate({ _id: session._id, photoScheduleCreated: { $ne: true } }, { $set: { photoScheduleCreated: true }, $push: { cameraPhotoRequests: { $each: requests } } }, { new: true });
            if (updated) session.cameraPhotoRequests = updated.cameraPhotoRequests;
            else session.cameraPhotoRequests = (await Session.findById(session._id)).cameraPhotoRequests;
        }
        res.json({
            sessionId: session._id,
            studentId: session.studentId,
            studentName: session.studentName || session.studentId,
            rollNumber: session.rollNumber || session.studentId,
            examId: session.examId,
            status: session.status,
            startTime: session.startTime,
            endTime: examEndTime,
            extraMinutes: examExtra,
            durationMinutes: durationMinutes,
            totalDurationMinutes: durationMinutes + examExtra,
            serverTime: new Date(),
            paperReleased: exam ? (exam.paperReleased !== false) : true,
            autoSubmitted: session.autoSubmitted || false,
            terminationReason: session.terminationReason,
            warnings: session.warnings || [],
            cameraPhotoRequest: exam?.examType !== 'physical_lab' && exam?.status === 'active' && session.status === 'active' ? nextPhotoRequest(session.cameraPhotoRequests, Date.now()) : null,
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
router.post('/:sessionId/warn', requireAuth, requireOwnedSession, async (req, res) => {
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
            await broadcastToExam(io, session.examId, 'candidateWarning', {
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
router.post('/:sessionId/terminate', requireAuth, requireOwnedSession, async (req, res) => {
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
            await broadcastToExam(io, session.examId, 'candidateTerminated', {
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

        // Record Teacher Action in Audit Log
        const { logTeacherAction } = require('../utils/auditLogger');
        await logTeacherAction(req, {
            action: 'SESSION_TERMINATED',
            targetType: 'session',
            targetId: session._id,
            targetSummary: `Terminated Candidate: ${session.studentName || session.studentId} (${session.rollNumber || 'N/A'}) - Reason: "${session.terminationReason}"`,
            details: {
                sessionId: session._id,
                examId: session.examId,
                studentName: session.studentName,
                rollNumber: session.rollNumber,
                reason: session.terminationReason
            }
        });

        res.json({ message: 'Candidate session terminated successfully', session });
    } catch (err) {
        console.error('Error terminating session:', err);
        res.status(500).json({ error: 'Failed to terminate session' });
    }
});

module.exports = router;
