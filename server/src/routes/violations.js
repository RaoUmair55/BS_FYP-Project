const express = require('express');
const mongoose = require('mongoose');
const Violation = require('../models/Violation');
const { broadcastViolation, broadcastRiskScoreUpdate } = require('../sockets/violationSocket');
const { calculateRiskScore } = require('../scoring/severityEngine');
const router = express.Router();

// POST /violation
router.post('/violation', async (req, res) => {
    // Check if mongo is connected
    if (mongoose.connection.readyState !== 1) {
        console.error('Failed to log violation: MongoDB is disconnected.');
        return res.status(503).json({ error: 'Service Unavailable: Database disconnected' });
    }

    try {
        const newViolation = new Violation(req.body);
        
        // Mongoose validate method will check required fields and enums
        const validationError = newViolation.validateSync();
        if (validationError) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: Object.keys(validationError.errors).map(key => ({
                    field: key,
                    message: validationError.errors[key].message
                }))
            });
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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /violations/:sessionId
router.get('/violations/:sessionId', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Service Unavailable: Database disconnected' });
    }

    try {
        const violations = await Violation.find({ sessionId: req.params.sessionId })
            .sort({ timestamp: -1 });
        res.json(violations);
    } catch (err) {
        console.error('Error fetching violations:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
