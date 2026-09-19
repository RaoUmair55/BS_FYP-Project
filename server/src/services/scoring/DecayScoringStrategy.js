const ScoringStrategy = require('./ScoringStrategy');

// Decay rate calculated for a 15-minute half-life.
// Formula: k = ln(2) / half_life => 0.693 / 15 ≈ 0.0462
const DECAY_RATE_PER_MINUTE = 0.0462;

// The sum of weights is scaled to 0-100.
// A raw sum of 10 points (e.g. two recent severity 5 violations) gives 100% risk.
const MAX_RAW_SCORE = 10.0;

/**
 * Exponential Decay Scoring Strategy
 * Calculates a 0-100 risk score where older violations decay over time (15-minute half-life).
 */
class DecayScoringStrategy extends ScoringStrategy {
    /**
     * Calculate normalized risk score using exponential time decay.
     * @param {Array<Object>} violations - Array of violation objects with severity and timestamp
     * @param {Date} [referenceTime=new Date()] - Reference timestamp for decay calculation
     * @returns {number} Score from 0 to 100
     */
    calculateScore(violations, referenceTime = new Date()) {
        if (!violations || violations.length === 0) {
            return 0;
        }

        const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
        let sumOfWeights = 0;

        for (let violation of violations) {
            const violationTime = new Date(violation.timestamp);
            // Calculate diff in minutes, ensure it's >= 0 (no future violations)
            const diffMinutes = Math.max(0, (now - violationTime) / (1000 * 60));

            // weight = severity * e^(-k * t)
            const severity = typeof violation.severity === 'number' ? violation.severity : 1;
            const weight = severity * Math.exp(-DECAY_RATE_PER_MINUTE * diffMinutes);
            sumOfWeights += weight;
        }

        // Normalize to 0-100 and cap at 100
        let riskScore = (sumOfWeights / MAX_RAW_SCORE) * 100;
        return Math.min(100, Math.round(riskScore));
    }
}

module.exports = DecayScoringStrategy;
