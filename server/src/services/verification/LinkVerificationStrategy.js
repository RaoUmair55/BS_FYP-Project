const jwt = require('jsonwebtoken');
const VerificationStrategy = require('./VerificationStrategy');

class LinkVerificationStrategy extends VerificationStrategy {
    /**
     * Generates a signed JWT token valid for 1 hour for magic link verification
     */
    async generateChallenge(teacherId, email) {
        const idStr = teacherId ? teacherId.toString() : '';
        const secret = process.env.EMAIL_TOKEN_SECRET || 'dev_email_token_secret_fallback_32bytes!!';
        
        const payload = jwt.sign(
            { teacherId: idStr, email, purpose: 'email_verification' },
            secret,
            { expiresIn: '1h' }
        );

        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        return {
            payload,
            expiresAt,
            type: 'link'
        };
    }

    /**
     * Verifies the submitted JWT link token
     */
    async verifyChallenge(teacherId, submittedValue) {
        try {
            if (!submittedValue) {
                return { valid: false, reason: 'Verification token is required.' };
            }

            const secret = process.env.EMAIL_TOKEN_SECRET || 'dev_email_token_secret_fallback_32bytes!!';
            const decoded = jwt.verify(submittedValue, secret);

            if (decoded.purpose !== 'email_verification') {
                return { valid: false, reason: 'Invalid token purpose.' };
            }

            if (teacherId && decoded.teacherId !== teacherId.toString()) {
                return { valid: false, reason: 'Token does not match the specified user account.' };
            }

            return { valid: true };
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return { valid: false, reason: 'Verification link has expired. Please request a new one.' };
            }
            return { valid: false, reason: 'Invalid verification link token.' };
        }
    }
}

module.exports = LinkVerificationStrategy;
