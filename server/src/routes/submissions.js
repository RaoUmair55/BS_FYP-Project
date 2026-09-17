const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Submission = require('../models/Submission');
const Session = require('../models/Session');

const uploadDir = path.join(__dirname, '../../uploads/submissions');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `${req.body.sessionId || 'session'}_${Date.now()}${ext}`;
        cb(null, name);
    }
});

const upload = multer({ storage });

// Wrapper middleware to support both JSON body and multipart form data
function handleUpload(req, res, next) {
    if (req.is('multipart/form-data')) {
        upload.single('file')(req, res, next);
    } else {
        next();
    }
}

// POST /submissions
router.post('/', handleUpload, async (req, res) => {
    try {
        const sessionId = req.body ? req.body.sessionId : null;
        const answerText = req.body ? req.body.answerText : '';

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const hasFile = !!req.file;
        const hasText = !!(answerText && answerText.trim().length > 0);

        if (!hasFile && !hasText) {
            return res.status(400).json({ error: 'Please provide typed text or attach an answer file.' });
        }

        let submissionType = 'text';
        if (hasFile && hasText) submissionType = 'both';
        else if (hasFile) submissionType = 'file';

        const relativePath = req.file ? `/uploads/submissions/${path.basename(req.file.path)}` : null;

        const submission = new Submission({
            sessionId,
            submissionType,
            answerText: answerText || '',
            filename: req.file ? req.file.originalname : null,
            filePath: relativePath || (req.file ? req.file.path : null),
            fileSize: req.file ? req.file.size : 0,
            uploadedAt: new Date()
        });

        await submission.save();

        try {
            await Session.findByIdAndUpdate(sessionId, { status: 'completed', endTime: new Date() });
        } catch (e) {
            // Ignore format mismatch if session ID is custom string
        }

        res.status(201).json({
            message: 'Exam submitted successfully',
            submissionId: submission._id,
            submissionType: submission.submissionType
        });
    } catch (err) {
        console.error('Error processing submission:', err);
        res.status(500).json({ error: 'Failed to process submission', details: err.message });
    }
});

// GET /submissions/:sessionId
router.get('/:sessionId', async (req, res) => {
    try {
        const submissions = await Submission.find({ sessionId: req.params.sessionId });
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

module.exports = router;
