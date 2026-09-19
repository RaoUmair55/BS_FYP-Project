const express = require('express');
const Teacher = require('../models/Teacher');
const mailService = require('../services/mail');
const verificationStrategy = require('../services/verification');

const router = express.Router();

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

        const query = teacherId ? { _id: teacherId } : { email: email.trim().toLowerCase() };
        const teacher = await Teacher.findOne(query);

        if (!teacher) {
            return res.status(404).json({ error: 'Teacher account not found' });
        }

        if (teacher.emailVerified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Generate challenge using the active strategy (Link or OTP)
        const challenge = await verificationStrategy.generateChallenge(teacher._id, teacher.email);

        let emailSubject = 'Verify your IntegrityFlow Teacher Account';
        let emailHtml = '';

        if (challenge.type === 'otp') {
            emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #4f46e5;">IntegrityFlow Email Verification</h2>
                    <p>Hello ${teacher.name},</p>
                    <p>Your 6-digit verification code is:</p>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e1b4b; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 6px; margin: 20px 0;">
                        ${challenge.payload}
                    </div>
                    <p style="color: #6b7280; font-size: 14px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
                </div>
            `;
        } else {
            const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
            const verificationUrl = `${dashboardUrl}/verify-email?token=${encodeURIComponent(challenge.payload)}&teacherId=${teacher._id}`;
            emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #4f46e5;">IntegrityFlow Email Verification</h2>
                    <p>Hello ${teacher.name},</p>
                    <p>Please click the button below to verify your email address and activate your instructor account:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verificationUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                            Verify Email Address
                        </a>
                    </div>
                    <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #4f46e5; font-size: 13px;">${verificationUrl}</p>
                    <p style="color: #6b7280; font-size: 14px;">This link will expire in 1 hour.</p>
                </div>
            `;
        }

        // Send email via the active mail provider
        const mailResult = await mailService.send({
            to: teacher.email,
            subject: emailSubject,
            html: emailHtml
        });

        return res.json({
            message: 'Verification challenge generated and dispatched successfully',
            strategy: challenge.type,
            expiresAt: challenge.expiresAt,
            mailResult: {
                success: mailResult.success,
                previewUrl: mailResult.previewUrl,
                messageId: mailResult.messageId
            },
            // Include challenge payload in response body for convenient development/testing
            testPayload: challenge.payload
        });
    } catch (err) {
        console.error('Verification send error:', err);
        return res.status(500).json({ error: 'Failed to send verification email', details: err.message });
    }
});

/**
 * POST /verification/confirm
 * Accepts teacherId (optional if token is self-contained JWT) and submittedValue
 */
router.post('/confirm', async (req, res) => {
    try {
        const { teacherId, submittedValue } = req.body;
        if (!submittedValue) {
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
        if (teacherId) {
            updatedTeacher = await Teacher.findByIdAndUpdate(
                teacherId,
                { emailVerified: true },
                { new: true }
            ).select('-passwordHash');
        }

        return res.json({
            message: 'Email address verified successfully.',
            verified: true,
            teacher: updatedTeacher
        });
    } catch (err) {
        console.error('Verification confirm error:', err);
        return res.status(500).json({ error: 'Failed to confirm verification', details: err.message });
    }
});

module.exports = router;
