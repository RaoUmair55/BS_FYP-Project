const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Session = require('../models/Session');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireOwnedSession } = require('../middleware/examAccess');
const { requireSessionAuthAllowEnded } = require('../middleware/sessionAuth');
const storageService = require('../services/storage');

const ALLOWED_SUBMISSION_EXTENSIONS = new Set([
    '.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.rtf', '.odt',
    '.ppt', '.pptx', '.xls', '.xlsx', '.zip',
    '.png', '.jpg', '.jpeg', '.webp',
    '.py', '.c', '.cpp', '.h', '.java', '.cs', '.sql', '.json', '.ipynb'
]);

const BLOCKED_SUBMISSION_MIME_TYPES = new Set([
    'text/html',
    'application/xhtml+xml',
    'image/svg+xml',
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'text/xml',
    'application/xml',
    'application/x-msdownload',
    'application/x-sh',
    'application/x-httpd-php'
]);

function sanitizeDownloadFilename(name, fallback = 'submission') {
    const base = path.basename(String(name || fallback))
        .replace(/[\r\n"\\/:*?<>|]/g, '_')
        .trim();
    return base || fallback;
}

// Use memory storage so file is passed to storageService
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(String(file.originalname || '')).toLowerCase();
        const mime = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
        if (!ALLOWED_SUBMISSION_EXTENSIONS.has(ext) || BLOCKED_SUBMISSION_MIME_TYPES.has(mime)) {
            return cb(new Error('Unsupported or unsafe file type. Allowed formats include PDF, Office documents, images, plain text, source code, and ZIP archives.'));
        }
        cb(null, true);
    }
});

// Wrapper middleware to support both JSON body and multipart form data
function handleUpload(req, res, next) {
    if (req.is('multipart/form-data')) {
        upload.single('file')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ error: err.message || 'Invalid submission file upload' });
            }
            next();
        });
    } else {
        next();
    }
}

// POST /submissions (Candidate-facing, session JWT required before multipart parsing)
router.post('/', requireSessionAuthAllowEnded, handleUpload, async (req, res) => {
    try {
        const bodySessionId = req.body ? req.body.sessionId : null;
        if (bodySessionId != null && String(bodySessionId) !== req.sessionClaims.sessionId) {
            return res.status(401).json({ error: 'Session credential does not match sessionId' });
        }
        const sessionId = req.sessionClaims.sessionId;
        const answerText = req.body?.answerText ?? '';

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({ error: 'Valid sessionId is required' });
        }
        if (typeof answerText !== 'string' || answerText.length > 100000) return res.status(400).json({ error: 'Invalid answerText' });

        const hasFile = !!req.file;
        const hasText = !!(answerText && answerText.trim().length > 0);

        const autoSubmitted = req.body && (req.body.autoSubmitted === 'true' || req.body.autoSubmitted === true);

        if (!hasFile && !hasText && !autoSubmitted) {
            return res.status(400).json({ error: 'Please provide typed text or attach an answer file.' });
        }

        let submissionType = 'text';
        if (hasFile && hasText) submissionType = 'both';
        else if (hasFile) submissionType = 'file';
        else if (hasText) submissionType = 'text';

        const session = await Session.findById(sessionId);
        if (!session) return res.status(404).json({ error: 'Active session not found' });
        if (session.status === 'terminated') {
            return res.status(403).json({ error: 'Session was terminated by examiner' });
        }
        const inAutoExpireGrace = session.status === 'completed'
            && session.autoSubmitted === true
            && autoSubmitted
            && (!session.endTime || Date.now() <= new Date(session.endTime).getTime() + 120_000);
        if (session.status !== 'active' && !inAutoExpireGrace) {
            return res.status(404).json({ error: 'Active session not found' });
        }
        if (session.endTime && Date.now() > new Date(session.endTime).getTime() + 60_000 && !autoSubmitted) {
            return res.status(403).json({ error: 'Submission window closed' });
        }
        if (await Submission.exists({ sessionId })) return res.status(409).json({ error: 'Exam already submitted' });

        let savedFile = null;
        if (req.file) {
            const ext = path.extname(req.file.originalname);
            const filename = `${sessionId}_${Date.now()}${ext}`;
            savedFile = await storageService.save(req.file.buffer, filename, 'submissions');
        }

        const submission = new Submission({
            sessionId,
            submissionType,
            answerText: answerText || (autoSubmitted ? '[Auto-Submitted on Time Expiry - No text entered]' : ''),
            filename: req.file ? req.file.originalname : null,
            filePath: savedFile ? savedFile.url : null,
            fileSize: req.file ? req.file.size : 0,
            uploadedAt: new Date()
        });

        await submission.save();

        try {
            await Session.findByIdAndUpdate(sessionId, {
                status: 'completed',
                endTime: new Date(),
                autoSubmitted: autoSubmitted
            });
        } catch (e) {
            // Ignore format mismatch if session ID is custom string
        }

        res.status(201).json({
            message: autoSubmitted ? 'Exam auto-submitted on time expiry' : 'Exam submitted successfully',
            submissionId: submission._id,
            submissionType: submission.submissionType,
            autoSubmitted
        });
    } catch (err) {
        console.error('Error processing submission:', err);
        res.status(500).json({ error: 'Failed to process submission', details: err.message });
    }
});

// GET /submissions/:sessionId
router.get('/:sessionId', requireAuth, requireOwnedSession, async (req, res) => {
    try {
        const submissions = await Submission.find({ sessionId: req.params.sessionId });
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// GET /submissions/:id/file - Stream or download file preserving original student filename
router.get('/:id/file', requireAuth, async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id);
        if (!submission || !submission.filePath) {
            return res.status(404).json({ error: 'Submission file not found' });
        }

        const session = await Session.findById(submission.sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const { ownsExam } = require('../middleware/examAccess');
        if (!await ownsExam(req, session.examId)) {
            return res.status(403).json({ error: 'Unauthorized access to submission' });
        }

        const originalFilename = sanitizeDownloadFilename(submission.filename || path.basename(submission.filePath));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

        if (submission.filePath.startsWith('/uploads/') || !submission.filePath.startsWith('http')) {
            const relPath = submission.filePath.startsWith('/uploads/')
                ? submission.filePath.replace('/uploads/', '')
                : submission.filePath;
            const uploadsRoot = path.resolve(__dirname, '../../uploads');
            const absolutePath = path.resolve(uploadsRoot, relPath);
            if (!absolutePath.startsWith(uploadsRoot + path.sep)) {
                return res.status(400).json({ error: 'Invalid submission path' });
            }
            const fs = require('fs');
            if (!fs.existsSync(absolutePath)) {
                return res.status(404).json({ error: 'File not found on disk' });
            }

            // Always serve candidate submissions as attachment to prevent active content / stored XSS execution
            res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"; filename*=UTF-8''${encodeURIComponent(originalFilename)}`);
            return res.sendFile(absolutePath);
        } else {
            return res.redirect(submission.filePath);
        }
    } catch (err) {
        console.error('Error serving submission file:', err);
        res.status(500).json({ error: 'Failed to retrieve submission file' });
    }
});

module.exports = router;
