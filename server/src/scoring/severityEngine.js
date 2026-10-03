const Violation = require('../models/Violation');
const scoringStrategy = require('../services/scoring');

async function calculateRiskScore(sessionId) {
    // Only active or confirmed violations contribute to the risk score (dismissed violations are excluded)
    const violations = await Violation.find({ 
        sessionId, 
        decision: { $ne: 'dismissed' } 
    }).sort({ timestamp: -1 });

    if (!violations || violations.length === 0) {
        return {
            sessionId,
            riskScore: 0,
            violationCount: 0,
            lastViolationAt: null
        };
    }

    // Late arrivals remain evidence, but affect scoring only after explicit examiner confirmation.
    const scoredViolations = violations.filter(v => !v.receivedLate || v.decision === 'confirmed');
    const riskScore = scoringStrategy.calculateScore(scoredViolations);

    return {
        sessionId,
        riskScore,
        violationCount: violations.length,
        lastViolationAt: violations[0].timestamp // Because they are sorted descending
    };
}

module.exports = { calculateRiskScore };
