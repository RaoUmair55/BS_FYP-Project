const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Violation = require('../models/Violation');
const Session = require('../models/Session');
const { broadcastViolation, broadcastRiskScoreUpdate, broadcastViolationReview } = require('../sockets/violationSocket');
const { calculateRiskScore } = require('../scoring/severityEngine');
const { requireAuth } = require('../middleware/authMiddleware');
const storageService = require('../services/storage');
const multer = require('multer');

// Configure multer for screenshot uploads using memory storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

const router = express.Router();

// POST /violation — Machine-to-machine (Candidate App -> Server, intentionally open)
router.post('/violation', upload.single('screenshot'), async (req, res) => {
    try {
        let details = req.body.details;
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (e) {}
        }
        
        let screenshotPath = req.body.screenshotPath || null;
        if (req.file) {
            try {
                const uniqueFilename = `screenshot-${Date.now()}-${req.file.originalname || 'snapshot.jpg'}`;
                const saved = await storageService.save(req.file.buffer, uniqueFilename, 'screenshots');
                screenshotPath = saved.url;
            } catch (uploadErr) {
                console.error('[Violations Route] Failed to upload screenshot to storage service:', uploadErr);
            }
        }
        
        const severity = parseInt(req.body.severity, 10) || req.body.severity;
        
        const newViolation = new Violation({
            sessionId: req.body.sessionId,
            type: req.body.type,
            severity: severity,
            timestamp: req.body.timestamp || new Date(),
            details: details,
            screenshotPath: screenshotPath,
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
        broadcastViolation(io, savedViolation);

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
        if (req.query.reviewed !== undefined) {
            query.reviewed = req.query.reviewed === 'true';
        }
        const violations = await Violation.find(query).sort({ timestamp: -1 });
        res.json(violations);
    } catch (err) {
        console.error('Error fetching all violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /violations/:sessionId — Get violations for specific session (Teacher-facing, protected)
router.get('/violations/:sessionId', requireAuth, async (req, res) => {
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
router.patch('/violations/:violationId/review', requireAuth, async (req, res) => {
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
