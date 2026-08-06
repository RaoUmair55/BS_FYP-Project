const express = require('express');
const Session = require('../models/Session');
const { calculateRiskScore } = require('../scoring/severityEngine');
const router = express.Router();

// GET /sessions/active
router.get('/active', async (req, res) => {
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
        const newSession = new Session({
            studentId: req.body.studentId,
            examId: req.body.examId
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

module.exports = router;
