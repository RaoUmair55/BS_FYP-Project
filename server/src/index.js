const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/db');
const { initSocket } = require('./sockets/violationSocket');
const { verifyAccessToken } = require('./utils/tokens');
const Teacher = require('./models/Teacher');
const Exam = require('./models/Exam');
const Session = require('./models/Session');
const Violation = require('./models/Violation');
const Submission = require('./models/Submission');
const { ownsExam } = require('./middleware/examAccess');

const app = express();
const server = http.createServer(app);

// Global Security & Parser Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cookieParser());
app.use(cors({
    origin: (origin, done) => done(null, !origin || origin === 'null' || origin === (process.env.DASHBOARD_URL || 'http://localhost:5173')),
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads (for screenshots, papers, verification photos)
app.use('/uploads', async (req, res, next) => {
    try {
        const token = req.query.token || req.headers.authorization?.replace(/^Bearer /, '');
        const decoded = verifyAccessToken(token);
        const teacher = await Teacher.findById(decoded.teacherId);
        if (!teacher) return res.status(401).json({ error: 'Authentication required' });
        req.teacher = { teacherId: teacher._id.toString(), role: teacher.role };
        const folder = req.path.split('/')[1];
        const storedUrl = `/uploads${req.path}`;
        let examCode = null;
        if (folder === 'papers') {
            const filename = path.basename(req.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const exam = await Exam.findOne({ paperPath: new RegExp(filename + '$') });
            examCode = exam?.examCode;
        } else if (folder === 'screenshots' || folder === 'audio_clips') {
            const violation = await Violation.findOne({ 
                $or: [{ screenshotPath: storedUrl }, { audioPath: storedUrl }] 
            });
            const session = violation && await Session.findById(violation.sessionId);
            examCode = session?.examId;
        } else if (folder === 'verification') {
            const session = await Session.findOne({ cameraVerificationPhoto: storedUrl });
            examCode = session?.examId;
        } else if (folder === 'submissions') {
            const submission = await Submission.findOne({ filePath: storedUrl });
            const session = submission && await Session.findById(submission.sessionId);
            examCode = session?.examId;
        }
        if (!examCode || !await ownsExam(req, examCode)) return res.status(404).json({ error: 'Asset not found' });
        next();
    } catch (err) { res.status(401).json({ error: 'Authentication required' }); }
}, express.static(path.join(__dirname, '../uploads')));

// Initialize Socket.io
const io = initSocket(server);
app.locals.io = io; // Make io accessible in routes

// Connect to MongoDB and bootstrap Root Super Admin
const seedAdmin = require('./config/seedAdmin');
const { autoExpireFinishedExams } = require('./utils/examLifecycle');

connectDB().then(() => {
    seedAdmin();
    // Check and expire finished exams on startup and periodically every 10 seconds
    autoExpireFinishedExams(io);
    setInterval(() => {
        autoExpireFinishedExams(io);
    }, 10000);
});

// Mount Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/violations'));
app.use('/sessions', require('./routes/sessions'));
app.use('/exam', require('./routes/examPaper'));
app.use('/exams', require('./routes/exams'));
app.use('/risk-score', require('./routes/riskScore'));
app.use('/submissions', require('./routes/submissions'));
app.use('/', require('./routes/messages'));
app.use('/admin', require('./routes/admin'));

// Test Route: /health
app.get('/health', (req, res) => {
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const isConnected = mongoose.connection.readyState === 1;
    res.json({
        status: "ok",
        db: isConnected ? "connected" : "disconnected"
    });
});

const PORT = process.env.SERVER_PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
