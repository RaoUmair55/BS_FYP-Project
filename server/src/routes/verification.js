const express = require('express');
const Teacher = require('../models/Teacher');
const { emailSchema } = require('../utils/inputValidation');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const verificationStrategy = require('../services/verification');

const sendVerificationEmail = require('../utils/sendVerificationEmail');
const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many verification requests. Please try again later.' } }));

/**
 * POST /verification/send
 * Accepts teacherId (or email), generates challenge via active strategy, and sends email
 */
router.post('/send', async (req, res) => {
    try {
        const { teacherId, email } = req.body;
        if (!teacherId && !email) {
            return res.status(400).json({ error: 'teacherId or email is required' });
        }

        if ((teacherId && (typeof teacherId !== 'string' || !mongoose.isValidObjectId(teacherId))) || (!teacherId && !emailSchema.safeParse(email).success)) return res.status(400).json({ error: 'Enter a valid account email or teacher ID' });
        const query = teacherId ? { _id: teacherId } : { email: email.trim().toLowerCase() };
        const teacher = await Teacher.findOne(query);

        if (!teacher) {
            return res.status(404).json({ error: 'Teacher account not found' });
        }

        if (teacher.emailVerified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        const { strategy, expiresAt, mailResult } = await sendVerificationEmail(teacher);

        return res.json({
            message: 'Verification challenge generated and dispatched successfully',
            strategy,
            expiresAt,

        });
    } catch (err) {
        console.error('Verification send error:', err);
        return res.status(500).json({ error: 'Failed to send verification email' });
    }
});

/**
 * POST /verification/confirm
 * Accepts teacherId (optional if token is self-contained JWT) and submittedValue
 */
router.post('/confirm', async (req, res) => {
    try {
        const { teacherId, submittedValue } = req.body;
        if (typeof submittedValue !== 'string' || !submittedValue || submittedValue.length > 4096 || (teacherId && (typeof teacherId !== 'string' || !mongoose.isValidObjectId(teacherId)))) {
            return res.status(400).json({ error: 'submittedValue (token or code) is required' });
        }

        // Verify challenge with active strategy
        const result = await verificationStrategy.verifyChallenge(teacherId, submittedValue);

        if (!result.valid) {
            return res.status(400).json({
                error: result.reason || 'Verification failed. Invalid or expired token/code.'
            });
        }

        // If teacherId provided, update Teacher
        let updatedTeacher = null;
        const verifiedId = result.teacherId || teacherId;
        if (verifiedId) {
            updatedTeacher = await Teacher.findByIdAndUpdate(
                verifiedId,
                { emailVerified: true },
                { new: true }
            ).select('-passwordHash');
        }

        if (!updatedTeacher) return res.status(404).json({ error: 'Teacher account not found' });
        return res.json({
            message: 'Email address verified successfully.',
            verified: true,
            teacher: updatedTeacher
        });
    } catch (err) {
        console.error('Verification confirm error:', err);
        return res.status(500).json({ error: 'Failed to confirm verification' });
    }
});

module.exports = router;
