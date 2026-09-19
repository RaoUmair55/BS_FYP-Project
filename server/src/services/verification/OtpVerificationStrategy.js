const crypto = require('crypto');
const VerificationStrategy = require('./VerificationStrategy');
const VerificationChallenge = require('../../models/VerificationChallenge');

class OtpVerificationStrategy extends VerificationStrategy {
    /**
     * Compute SHA-256 hash of the 6-digit OTP code
     */
    _hashCode(code) {
        return crypto.createHash('sha256').update(code.toString().trim()).digest('hex');
    }

    /**
     * Generate a 6-digit OTP code, save hash and 10-minute expiry to DB
     */
    async generateChallenge(teacherId, email) {
        const idStr = teacherId ? teacherId.toString() : null;
        if (!idStr) {
            throw new Error('teacherId is required to generate OTP challenge');
        }

        // Generate cryptographically random 6-digit numeric string
        const randomNum = crypto.randomInt(100000, 999999).toString();
        const codeHash = this._hashCode(randomNum);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Invalidate previous challenges for this teacher
        await VerificationChallenge.deleteMany({ teacherId: idStr });

        const challenge = await VerificationChallenge.create({
            teacherId: idStr,
            codeHash,
            expiresAt,
            attempts: 0
        });

        return {
            challengeId: challenge._id.toString(),
            payload: randomNum, // The raw 6-digit code to email the user
            expiresAt,
            type: 'otp'
        };
    }

    /**
     * Verify the 6-digit OTP code against the latest stored challenge
     */
    async verifyChallenge(teacherId, submittedValue) {
        try {
            if (!submittedValue) {
                return { valid: false, reason: 'Verification code is required.' };
            }

            const idStr = teacherId ? teacherId.toString() : null;
            if (!idStr) {
                return { valid: false, reason: 'teacherId is required for verification.' };
            }

            const challenge = await VerificationChallenge.findOne({
                teacherId: idStr
            }).sort({ createdAt: -1 });

            if (!challenge) {
                return { valid: false, reason: 'No active verification code found. Please request a new code.' };
            }

            // Increment attempt counter
            challenge.attempts = (challenge.attempts || 0) + 1;

            // Reject if maximum 5 attempts reached
            if (challenge.attempts > 5) {
                await challenge.save();
                return { valid: false, reason: 'Too many incorrect attempts. This code has been invalidated. Please request a new one.' };
            }

            // Check if expired
            if (new Date(challenge.expiresAt) < new Date()) {
                await challenge.save();
                return { valid: false, reason: 'Verification code has expired. Please request a new one.' };
            }

            const submittedHash = this._hashCode(submittedValue);
            if (submittedHash !== challenge.codeHash) {
                await challenge.save();
                const remaining = 5 - challenge.attempts;
                return { 
                    valid: false, 
                    reason: `Invalid verification code. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Code is now locked.'}` 
                };
            }

            // Successful match: remove challenge
            await VerificationChallenge.deleteOne({ _id: challenge._id });

            return { valid: true };
        } catch (err) {
            console.error('OtpVerificationStrategy verifyChallenge error:', err);
            return { valid: false, reason: 'Failed to verify OTP code.' };
        }
    }
}

module.exports = OtpVerificationStrategy;
