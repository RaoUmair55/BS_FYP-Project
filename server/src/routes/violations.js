const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Violation = require('../models/Violation');
const Session = require('../models/Session');
const { broadcastViolation, broadcastRiskScoreUpdate } = require('../sockets/violationSocket');
const { calculateRiskScore } = require('../scoring/severityEngine');
const multer = require('multer');

// Configure multer for screenshot uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/screenshots');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const router = express.Router();

// POST /violation
router.post('/violation', upload.single('screenshot'), async (req, res) => {
    try {
        // Handle multipart/form-data stringified fields
        let details = req.body.details;
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (e) {
                // fallback
            }
        }
        
        let screenshotPath = req.body.screenshotPath;
        if (req.file) {
            screenshotPath = `/uploads/screenshots/${req.file.filename}`;
        }
        
        const severity = parseInt(req.body.severity, 10) || req.body.severity;
        // Validation check for unknown sessionId
        const sessionExists = await Session.exists({ _id: req.body.sessionId }).catch(() => null);
        if (!sessionExists && mongoose.connection.readyState === 1) {
            console.warn(`[WARNING] Violation received for unknown sessionId: ${req.body.sessionId}`);
        }

        const newViolation = new Violation({
            sessionId: req.body.sessionId,
            type: req.body.type,
            severity: severity,
            timestamp: req.body.timestamp,
            details: details,
            screenshotPath: screenshotPath
        });

        // Check if MongoDB is connected (readyState 1 = connected)
        if (mongoose.connection.readyState !== 1) {
            console.warn('[WARNING] MongoDB unreachable. Writing violation to local fallback.');
            const fallbackDir = path.join(__dirname, '../../uploads/failed-violations');
            if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
            }
            const fallbackPath = path.join(fallbackDir, `violation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`);
            fs.writeFileSync(fallbackPath, JSON.stringify(newViolation.toObject(), null, 2));
            
            // Still broadcast if possible
            const io = req.app.locals.io;
            broadcastViolation(io, newViolation);
            
            // Return 200 so candidate app doesn't retry
            return res.status(200).json({ message: "Saved locally (MongoDB unreachable)", fallback: true });
        }

        const savedViolation = await newViolation.save();

        // Broadcast the violation using the io instance stored in app.locals
        const io = req.app.locals.io;
        broadcastViolation(io, savedViolation);

        // Calculate and broadcast updated risk score
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

// GET /violations/:sessionId
router.get('/violations/:sessionId', async (req, res) => {
    try {
        const violations = await Violation.find({ sessionId: req.params.sessionId }).sort({ timestamp: -1 });
        res.json(violations);
    } catch (err) {
        console.error('Error fetching violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
