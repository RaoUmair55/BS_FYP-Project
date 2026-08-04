const express = require('express');
const { calculateRiskScore } = require('../scoring/severityEngine');
const router = express.Router();

// GET /risk-score/:sessionId
router.get('/:sessionId', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        // We recalculate on-demand rather than storing a live score in the DB.
        // This is much simpler for the FYP scope, avoids race conditions with 
        // concurrent violations, and is perfectly accurate as long as it's called 
        // reasonably often (like when the dashboard refreshes or receives a socket event).
        const result = await calculateRiskScore(sessionId);
        res.json(result);
    } catch (err) {
        console.error('Error calculating risk score:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
