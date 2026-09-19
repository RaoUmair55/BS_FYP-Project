const DecayScoringStrategy = require('./DecayScoringStrategy');

/**
 * Active Scoring Strategy
 * 
 * IntegrityFlow uses the Strategy Pattern for calculating candidate risk scores.
 * To swap the scoring engine in the future (e.g. LinearScoringStrategy,
 * WeightedAverageStrategy, or MLScoringStrategy), implement the ScoringStrategy
 * interface and change the exported instance below.
 */
const scoringStrategy = new DecayScoringStrategy();

module.exports = scoringStrategy;
module.exports.DecayScoringStrategy = DecayScoringStrategy;
