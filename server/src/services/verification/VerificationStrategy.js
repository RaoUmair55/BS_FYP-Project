/**
 * Abstract VerificationStrategy Interface
 * Defines the contract for email verification mechanisms (Magic Link, OTP code, etc.)
 */
class VerificationStrategy {
    /**
     * Generate a verification challenge for a teacher
     * @param {string|mongoose.Types.ObjectId} teacherId
     * @param {string} [email]
     * @returns {Promise<{ challengeId?: string, payload: string, expiresAt: Date, type: string }>}
     */
    async generateChallenge(teacherId, email) {
        throw new Error("Method 'generateChallenge(teacherId, email)' must be implemented by concrete strategy.");
    }

    /**
     * Verify a submitted challenge value (e.g. JWT token or OTP code)
     * @param {string|mongoose.Types.ObjectId} teacherId
     * @param {string} submittedValue - Token string or 6-digit OTP code
     * @returns {Promise<{ valid: boolean, reason?: string }>}
     */
    async verifyChallenge(teacherId, submittedValue) {
        throw new Error("Method 'verifyChallenge(teacherId, submittedValue)' must be implemented by concrete strategy.");
    }
}

module.exports = VerificationStrategy;
