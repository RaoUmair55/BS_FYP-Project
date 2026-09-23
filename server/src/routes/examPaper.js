const express = require('express');
const multer = require('multer');
const path = require('path');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const { requireAuth } = require('../middleware/authMiddleware');
const storageService = require('../services/storage');
const router = express.Router();

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || 
            file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            file.mimetype === 'application/msword') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF and DOCX are allowed.'));
        }
    }
});

// Helper for multer errors
const uploadMiddleware = (req, res, next) => {
    upload.single('paper')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
};

// GET /exam (Teacher-facing)
// Lists all created exams
router.get('/', requireAuth, async (req, res) => {
    try {
        const exams = await Exam.find().sort({ createdAt: -1 });
        res.json(exams);
    } catch (err) {
        console.error('Error fetching exams:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /exam/:examId/paper (Teacher-facing)
router.post('/:examId/paper', requireAuth, uploadMiddleware, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const examId = req.params.examId;
        const uniqueFilename = `${examId}-${Date.now()}${path.extname(req.file.originalname)}`;
        const saved = await storageService.save(req.file.buffer, uniqueFilename, 'papers');

        const paperPath = saved.path;
        const paperFilename = req.file.originalname;

        // Upsert Exam document
        const exam = await Exam.findOneAndUpdate(
            { examId },
            { paperPath, paperFilename },
            { new: true, upsert: true }
        );

        res.status(201).json({ message: 'Exam paper uploaded successfully', exam });
    } catch (err) {
        console.error('Error uploading exam paper:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /exam/:examId/paper
router.get('/:examId/paper', async (req, res) => {
    try {
        const examId = req.params.examId;
        const mongoose = require('mongoose');

        // Security check - must have at least one active session for this exam
        const sessionQuery = [
            { examId: new RegExp('^' + examId + '$', 'i') }
        ];
        if (mongoose.Types.ObjectId.isValid(examId)) {
            sessionQuery.push({ examId: examId });
        }

        const activeSession = await Session.findOne({ 
            $or: sessionQuery,
            status: "active" 
        });
        if (!activeSession) {
            return res.status(403).json({ error: 'Exam paper only available once candidate exam session is active.' });
        }

        const examQuery = [
            { examCode: new RegExp('^' + examId + '$', 'i') },
            { examId: new RegExp('^' + examId + '$', 'i') }
        ];
        if (mongoose.Types.ObjectId.isValid(examId)) {
            examQuery.push({ _id: examId });
        }

        const exam = await Exam.findOne({ $or: examQuery });
        if (!exam || !exam.paperPath) {
            return res.status(404).json({ error: 'Exam paper not found' });
        }

        // Waiting Lobby Check: If examiner has not released the paper, lock delivery
        if (exam.paperReleased === false) {
            return res.status(423).json({
                error: 'Question paper is locked in the waiting lobby. Waiting for examiner release.',
                paperReleased: false
            });
        }

        // 1. Check if a local file exists on disk first (e.g. uploads/papers/...)
        const fs = require('fs');
        const path = require('path');
        const localCandidates = [];
        if (exam.paperPath && !exam.paperPath.startsWith('http://') && !exam.paperPath.startsWith('https://')) {
            localCandidates.push(exam.paperPath);
            localCandidates.push(path.join(__dirname, '../../uploads', exam.paperPath));
            localCandidates.push(path.join(__dirname, '../../uploads/papers', exam.paperPath));
        }
        if (exam.paperFilename) {
            localCandidates.push(path.join(__dirname, '../../uploads/papers', exam.paperFilename));
        }
        if (exam.paperPath) {
            const base = path.basename(exam.paperPath);
            localCandidates.push(path.join(__dirname, '../../uploads/papers', base));
        }

        for (const cand of localCandidates) {
            if (fs.existsSync(cand)) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="${exam.paperFilename || 'exam_paper.pdf'}"`);
                return res.sendFile(path.resolve(cand));
            }
        }

        // 2. If stored in Cloudinary / remote URL, fetch and stream the buffer directly
        if (exam.paperPath && (exam.paperPath.startsWith('http://') || exam.paperPath.startsWith('https://'))) {
            try {
                const remoteRes = await fetch(exam.paperPath);
                if (remoteRes.ok) {
                    const buffer = await remoteRes.arrayBuffer();
                    const contentType = remoteRes.headers.get('content-type') || (
                        (exam.paperFilename && exam.paperFilename.endsWith('.pdf')) ? 'application/pdf' : 'application/octet-stream'
                    );
                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Content-Disposition', `inline; filename="${exam.paperFilename || 'exam_paper.pdf'}"`);
                    return res.send(Buffer.from(buffer));
                }
                
                console.error(`[ExamPaper] Remote fetch failed with status: ${remoteRes.status}`);
                if (remoteRes.status === 401) {
                    return res.status(401).json({ 
                        error: 'Cloudinary blocked PDF delivery (HTTP 401). Please re-upload the exam paper or enable "PDF and ZIP file delivery" in your Cloudinary Security Settings.' 
                    });
                }
                return res.status(remoteRes.status).json({ error: 'Failed to fetch exam paper from storage' });
            } catch (remoteErr) {
                console.error('[ExamPaper] Error proxying remote paper:', remoteErr);
                return res.status(500).json({ error: 'Failed to stream remote paper' });
            }
        }

        const exists = await storageService.exists(exam.paperPath);
        if (!exists) {
            return res.status(404).json({ error: 'File missing on server' });
        }

        // Stream the local file back
        res.setHeader('Content-Disposition', `inline; filename="${exam.paperFilename || 'exam_paper.pdf'}"`);
        res.sendFile(storageService.getAbsolutePath(exam.paperPath));

    } catch (err) {
        console.error('Error serving exam paper:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
