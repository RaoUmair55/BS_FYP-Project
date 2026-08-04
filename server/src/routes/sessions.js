const express = require('express');
const Session = require('../models/Session');
const router = express.Router();

// GET /sessions/active
router.get('/active', async (req, res) => {
    try {
        const activeSessions = await Session.find({ status: "active" });
        res.json(activeSessions);
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

module.exports = router;
