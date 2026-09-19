/**
 * Abstract ScoringStrategy Interface
 * Any scoring algorithm (Decay, Linear, Weighted Average, ML-based) must implement this interface.
 */
class ScoringStrategy {
    /**
     * Calculate a normalized risk score (0-100) from a list of violations.
     * @param {Array<Object>} violations - Array of violation objects with severity and timestamp
     * @param {Date} [referenceTime=new Date()] - Reference time for temporal calculations
     * @returns {number} Score from 0 to 100
     */
    calculateScore(violations, referenceTime = new Date()) {
        throw new Error("Method 'calculateScore(violations, referenceTime)' must be implemented by concrete subclass.");
    }
}

module.exports = ScoringStrategy;
