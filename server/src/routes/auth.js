const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

const Teacher = require('../models/Teacher');
const RefreshToken = require('../models/RefreshToken');
const AuthAuditLog = require('../models/AuthAuditLog');
const { generateAccessToken, generateRefreshToken, hashToken } = require('../utils/tokens');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// -------------------------------------------------------------
// Rate Limiters
// -------------------------------------------------------------

// /auth/login: max 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts from this IP. Please try again after 15 minutes.' }
});

// /auth/forgot-password: max 5 requests per hour per IP
const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password reset requests from this IP. Please try again later.' }
});

// -------------------------------------------------------------
// Validation Schemas (Zod)
// -------------------------------------------------------------

const signupSchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    password: z.string()
        .min(8, 'Password must be at least 8 characters long')
        .regex(/\d/, 'Password must contain at least one number'),
    role: z.enum(['teacher', 'admin']).optional()
});

const loginSchema = z.object({
    email: z.string().trim().email('Invalid email address').toLowerCase(),
    password: z.string().min(1, 'Password is required')
});

const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z.string()
        .min(8, 'Password must be at least 8 characters long')
        .regex(/\d/, 'Password must contain at least one number')
});

// -------------------------------------------------------------
// Helper: Cookie options
// -------------------------------------------------------------
const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE = 14 * 24 * 60 * 60 * 1000; // 14 days

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: REFRESH_COOKIE_MAX_AGE
    };
}

function getClearCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    };
}

// -------------------------------------------------------------
// Routes
// -------------------------------------------------------------

/**
 * POST /auth/signup
 */
router.post('/signup', async (req, res) => {
    try {
        const validation = signupSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors.map(e => e.message)
            });
        }

        const { name, email, password, role } = validation.data;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';

        // Check if teacher email already exists
        const existingTeacher = await Teacher.findOne({ email });
        if (existingTeacher) {
            return res.status(409).json({ error: 'Email is already registered' });
        }

        // Hash password with bcrypt (12 rounds)
        const passwordHash = await bcrypt.hash(password, 12);

        // Public registration always assigns default role 'teacher'
        const newTeacher = new Teacher({
            name,
            email,
            passwordHash,
            role: 'teacher',
            emailVerified: false,
            failedLoginAttempts: 0
        });

        const savedTeacher = await newTeacher.save();

        // Log audit event
        await AuthAuditLog.create({
            teacherId: savedTeacher._id,
            email: savedTeacher.email,
            event: 'signup',
            ipAddress
        });

        // Generate tokens immediately (Part B documents enforcing verification later)
        const accessToken = generateAccessToken(savedTeacher);
        const { token: rawRefreshToken, tokenHash } = generateRefreshToken();
        const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE);

        await RefreshToken.create({
            teacherId: savedTeacher._id,
            tokenHash,
            expiresAt
        });

        res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getCookieOptions());

        return res.status(201).json({
            message: 'Teacher registered successfully',
            accessToken,
            teacher: {
                id: savedTeacher._id,
                name: savedTeacher.name,
                email: savedTeacher.email,
                role: savedTeacher.role,
                emailVerified: savedTeacher.emailVerified,
                createdAt: savedTeacher.createdAt
            }
        });
    } catch (err) {
        console.error('Signup error:', err);
        return res.status(500).json({ error: 'Registration failed', details: err.message });
    }
});

/**
 * POST /auth/login
 */
router.post('/login', loginLimiter, async (req, res) => {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const genericErrorMessage = 'Invalid email or password';

    try {
        const validation = loginSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors.map(e => e.message)
            });
        }

        const { email, password } = validation.data;

        // Find teacher by email
        const teacher = await Teacher.findOne({ email });
        if (!teacher) {
            await AuthAuditLog.create({
                teacherId: null,
                email,
                event: 'login_failed',
                ipAddress
            });
            return res.status(401).json({ error: genericErrorMessage });
        }

        // Check account lockout
        if (teacher.lockedUntil && new Date(teacher.lockedUntil) > new Date()) {
            return res.status(401).json({ error: genericErrorMessage });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, teacher.passwordHash);
        if (!isMatch) {
            teacher.failedLoginAttempts = (teacher.failedLoginAttempts || 0) + 1;

            if (teacher.failedLoginAttempts >= 5) {
                teacher.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15-minute lockout
                await teacher.save();

                await AuthAuditLog.create({
                    teacherId: teacher._id,
                    email: teacher.email,
                    event: 'account_locked',
                    ipAddress
                });
            } else {
                await teacher.save();

                await AuthAuditLog.create({
                    teacherId: teacher._id,
                    email: teacher.email,
                    event: 'login_failed',
                    ipAddress
                });
            }

            return res.status(401).json({ error: genericErrorMessage });
        }

        // On successful login: reset failed attempts & lockout
        teacher.failedLoginAttempts = 0;
        teacher.lockedUntil = null;
        await teacher.save();

        // Generate tokens
        const accessToken = generateAccessToken(teacher);
        const { token: rawRefreshToken, tokenHash } = generateRefreshToken();
        const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE);

        await RefreshToken.create({
            teacherId: teacher._id,
            tokenHash,
            expiresAt
        });

        // Set refresh token in httpOnly cookie
        res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, getCookieOptions());

        await AuthAuditLog.create({
            teacherId: teacher._id,
            email: teacher.email,
            event: 'login_success',
            ipAddress
        });

        return res.json({
            message: 'Login successful',
            accessToken,
            teacher: {
                id: teacher._id,
                name: teacher.name,
                email: teacher.email,
                role: teacher.role,
                emailVerified: teacher.emailVerified
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Login failed', details: err.message });
    }
});

/**
 * POST /auth/refresh
 * Reads refresh token from httpOnly cookie, validates, and rotates token
 */
router.post('/refresh', async (req, res) => {
    try {
        const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
        if (!rawRefreshToken) {
            return res.status(401).json({ error: 'Refresh token not found' });
        }

        const tokenHash = hashToken(rawRefreshToken);
        const storedToken = await RefreshToken.findOne({ tokenHash });

        if (!storedToken || storedToken.revoked || new Date(storedToken.expiresAt) < new Date()) {
            res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
            return res.status(401).json({ error: 'Invalid, expired, or revoked refresh token' });
        }

        const teacher = await Teacher.findById(storedToken.teacherId);
        if (!teacher) {
            res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
            return res.status(401).json({ error: 'Teacher not found' });
        }

        // Rotate Refresh Token: Revoke old token
        storedToken.revoked = true;
        await storedToken.save();

        // Generate new access + refresh token
        const newAccessToken = generateAccessToken(teacher);
        const { token: newRawRefreshToken, tokenHash: newTokenHash } = generateRefreshToken();
        const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE);

        await RefreshToken.create({
            teacherId: teacher._id,
            tokenHash: newTokenHash,
            expiresAt
        });

        res.cookie(REFRESH_COOKIE_NAME, newRawRefreshToken, getCookieOptions());

        return res.json({
            accessToken: newAccessToken
        });
    } catch (err) {
        console.error('Refresh token error:', err);
        return res.status(500).json({ error: 'Token refresh failed' });
    }
});

/**
 * POST /auth/logout
 */
router.post('/logout', async (req, res) => {
    try {
        const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';

        if (rawRefreshToken) {
            const tokenHash = hashToken(rawRefreshToken);
            const storedToken = await RefreshToken.findOne({ tokenHash });

            if (storedToken) {
                storedToken.revoked = true;
                await storedToken.save();

                const teacher = await Teacher.findById(storedToken.teacherId);
                await AuthAuditLog.create({
                    teacherId: storedToken.teacherId,
                    email: teacher ? teacher.email : 'unknown',
                    event: 'logout',
                    ipAddress
                });
            }
        }

        res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
        return res.json({ message: 'Logged out successfully' });
    } catch (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
    }
});

/**
 * POST /auth/forgot-password
 */
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const genericSuccessResponse = {
        message: 'If an account with that email exists, a password reset link has been sent.'
    };

    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const teacher = await Teacher.findOne({ email: normalizedEmail });

        if (teacher) {
            const resetSecret = process.env.RESET_TOKEN_SECRET || 'dev_reset_token_secret_fallback_key_32bytes!!';
            const resetToken = jwt.sign(
                { teacherId: teacher._id.toString(), email: teacher.email, type: 'password_reset' },
                resetSecret,
                { expiresIn: '30m' }
            );

            // Log token to console for testability in FYP / development
            console.log(`[AUTH] Password reset token generated for ${teacher.email}: ${resetToken}`);

            await AuthAuditLog.create({
                teacherId: teacher._id,
                email: teacher.email,
                event: 'password_reset_requested',
                ipAddress
            });
        }

        // Return same message regardless of whether email exists to prevent enumeration
        return res.json(genericSuccessResponse);
    } catch (err) {
        console.error('Forgot password error:', err);
        return res.status(500).json({ error: 'Failed to process password reset request' });
    }
});

/**
 * POST /auth/reset-password
 */
router.post('/reset-password', async (req, res) => {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';

    try {
        const validation = resetPasswordSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.error.errors.map(e => e.message)
            });
        }

        const { token, newPassword } = validation.data;
        const resetSecret = process.env.RESET_TOKEN_SECRET || 'dev_reset_token_secret_fallback_key_32bytes!!';

        let decoded;
        try {
            decoded = jwt.verify(token, resetSecret);
        } catch (jwtErr) {
            return res.status(400).json({ error: 'Invalid or expired password reset token' });
        }

        if (decoded.type !== 'password_reset' || !decoded.teacherId) {
            return res.status(400).json({ error: 'Invalid reset token payload' });
        }

        const teacher = await Teacher.findById(decoded.teacherId);
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Hash new password and reset lockouts
        const newPasswordHash = await bcrypt.hash(newPassword, 12);
        teacher.passwordHash = newPasswordHash;
        teacher.failedLoginAttempts = 0;
        teacher.lockedUntil = null;
        await teacher.save();

        // Revoke ALL existing refresh tokens for this teacher (forces re-login everywhere)
        await RefreshToken.updateMany(
            { teacherId: teacher._id, revoked: false },
            { $set: { revoked: true } }
        );

        await AuthAuditLog.create({
            teacherId: teacher._id,
            email: teacher.email,
            event: 'password_reset_completed',
            ipAddress
        });

        return res.json({ message: 'Password has been successfully reset. Please log in with your new password.' });
    } catch (err) {
        console.error('Reset password error:', err);
        return res.status(500).json({ error: 'Failed to reset password' });
    }
});

/**
 * GET /auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
    try {
        const teacher = await Teacher.findById(req.teacher.teacherId).select('-passwordHash');
        if (!teacher) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        return res.json({
            teacher: {
                id: teacher._id,
                name: teacher.name,
                email: teacher.email,
                role: teacher.role,
                emailVerified: teacher.emailVerified,
                createdAt: teacher.createdAt
            }
        });
    } catch (err) {
        console.error('Get me error:', err);
        return res.status(500).json({ error: 'Failed to fetch current user' });
    }
});

module.exports = router;
