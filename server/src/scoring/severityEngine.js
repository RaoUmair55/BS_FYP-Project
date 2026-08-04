const Violation = require('../models/Violation');

// Decay rate calculated for a 15-minute half-life.
// Formula: k = ln(2) / half_life => 0.693 / 15 ≈ 0.0462
const DECAY_RATE_PER_MINUTE = 0.0462;
// The sum of weights is scaled to 0-100.
// Let's say a raw sum of 10 points (e.g. two recent severity 5 violations) gives 100% risk.
const MAX_RAW_SCORE = 10.0;

async function calculateRiskScore(sessionId) {
    const violations = await Violation.find({ sessionId }).sort({ timestamp: -1 });

    if (!violations || violations.length === 0) {
        return {
            sessionId,
            riskScore: 0,
            violationCount: 0,
            lastViolationAt: null
        };
    }

    const now = new Date();
    let sumOfWeights = 0;

    for (let violation of violations) {
        const violationTime = new Date(violation.timestamp);
        // Calculate diff in minutes, ensure it's >= 0 (no future violations)
        const diffMinutes = Math.max(0, (now - violationTime) / (1000 * 60));
        
        // weight = severity * e^(-k * t)
        const weight = violation.severity * Math.exp(-DECAY_RATE_PER_MINUTE * diffMinutes);
        sumOfWeights += weight;
    }

    // Normalize to 0-100 and cap at 100
    let riskScore = (sumOfWeights / MAX_RAW_SCORE) * 100;
    riskScore = Math.min(100, Math.round(riskScore));

    return {
        sessionId,
        riskScore,
        violationCount: violations.length,
        lastViolationAt: violations[0].timestamp // Because they are sorted descending
    };
}

module.exports = { calculateRiskScore };
