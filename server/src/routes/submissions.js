const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const Submission = require('../models/Submission');
const Session = require('../models/Session');
const storageService = require('../services/storage');

// Use memory storage so file is passed to storageService
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

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

        let savedFile = null;
        if (req.file) {
            const ext = path.extname(req.file.originalname);
            const filename = `${sessionId}_${Date.now()}${ext}`;
            savedFile = await storageService.save(req.file.buffer, filename, 'submissions');
        }

        const submission = new Submission({
            sessionId,
            submissionType,
            answerText: answerText || '',
            filename: req.file ? req.file.originalname : null,
            filePath: savedFile ? savedFile.url : null,
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
