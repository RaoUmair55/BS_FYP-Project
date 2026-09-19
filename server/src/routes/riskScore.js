const express = require('express');
const { calculateRiskScore } = require('../scoring/severityEngine');
const { requireAuth } = require('../middleware/authMiddleware');
const router = express.Router();

// GET /risk-score/:sessionId (Teacher-facing, protected)
router.get('/:sessionId', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const result = await calculateRiskScore(sessionId);
        res.json(result);
    } catch (err) {
        console.error('Error calculating risk score:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
