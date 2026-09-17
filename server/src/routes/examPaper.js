const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const router = express.Router();

// Ensure uploads/papers directory exists
const uploadDir = path.join(__dirname, '../../uploads/papers');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage and validation
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // e.g., exam123-1691234567.pdf
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, req.params.examId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
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

// GET /exam
// Lists all created exams
router.get('/', async (req, res) => {
    try {
        const exams = await Exam.find().sort({ createdAt: -1 });
        res.json(exams);
    } catch (err) {
        console.error('Error fetching exams:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /exam/:examId/paper
router.post('/:examId/paper', uploadMiddleware, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const examId = req.params.examId;
        const paperPath = req.file.path;
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

        // IMPORTANT: Security check - must have at least one active session for this exam
        const activeSession = await Session.findOne({ 
            examId: new RegExp('^' + examId + '$', 'i'), 
            status: "active" 
        });
        if (!activeSession) {
            return res.status(403).json({ error: 'Exam paper only available once candidate exam session is active.' });
        }

        const exam = await Exam.findOne({ 
            $or: [
                { examCode: new RegExp('^' + examId + '$', 'i') },
                { examId: new RegExp('^' + examId + '$', 'i') }
            ]
        });
        if (!exam || !exam.paperPath) {
            return res.status(404).json({ error: 'Exam paper not found' });
        }

        if (!fs.existsSync(exam.paperPath)) {
            return res.status(404).json({ error: 'File missing on server' });
        }

        // Stream the file back
        res.setHeader('Content-Disposition', `inline; filename="${exam.paperFilename}"`);
        res.sendFile(path.resolve(exam.paperPath));

    } catch (err) {
        console.error('Error serving exam paper:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
