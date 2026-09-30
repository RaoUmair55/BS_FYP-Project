const ScoringStrategy = require('./ScoringStrategy');

// Decay rate calculated for a 30-minute half-life.
// Formula: k = ln(2) / half_life => 0.693 / 30 ≈ 0.0231
const DECAY_RATE_PER_MINUTE = 0.0231;

// The sum of weights is scaled to 0-100.
// A raw sum of 10 points (e.g. two recent severity 5 violations) gives 100% risk.
const MAX_RAW_SCORE = 10.0;

/**
 * Exponential Decay Scoring Strategy with Cumulative Baseline
 * Calculates a 0-100 risk score where recent violations produce an acute burst,
 * while confirmed/unreviewed violations retain a persistent baseline floor so
 * integrity violations do not evaporate to 0% during or after an exam.
 */
class DecayScoringStrategy extends ScoringStrategy {
    /**
     * Calculate normalized risk score using exponential time decay + persistent baseline.
     * @param {Array<Object>} violations - Array of violation objects with severity and timestamp
     * @param {Date} [referenceTime=new Date()] - Reference timestamp for decay calculation
     * @returns {number} Score from 0 to 100
     */
    calculateScore(violations, referenceTime = new Date()) {
        if (!violations || violations.length === 0) {
            return 0;
        }

        const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
        let recentBurstWeight = 0;
        let cumulativeBaseWeight = 0;

        for (let violation of violations) {
            const violationTime = new Date(violation.timestamp);
            const diffMinutes = Math.max(0, (now - violationTime) / (1000 * 60));
            const severity = typeof violation.severity === 'number' ? violation.severity : 1;

            // Recency factor with 30-minute half-life
            const recencyFactor = Math.exp(-DECAY_RATE_PER_MINUTE * diffMinutes);
            recentBurstWeight += severity * recencyFactor;

            // Cumulative baseline: ensures past violations maintain a floor
            cumulativeBaseWeight += severity * 0.55;
        }

        // Total weight combines active recency burst and cumulative baseline
        const totalWeight = Math.max(
            (recentBurstWeight * 0.55) + (cumulativeBaseWeight * 0.45),
            cumulativeBaseWeight * 0.6
        );

        // Normalize to 0-100 and cap at 100
        let riskScore = (totalWeight / MAX_RAW_SCORE) * 100;
        return Math.min(100, Math.max(1, Math.round(riskScore)));
    }
}

module.exports = DecayScoringStrategy;
