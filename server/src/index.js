const requireEmailVerification = require('./utils/emailVerification');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('./config/db');
const { initSocket } = require('./sockets/violationSocket');
const { verifyAccessToken, verifyMediaToken } = require('./utils/tokens');
const { escapeRegex } = require('./utils/regex');
const Teacher = require('./models/Teacher');
const Exam = require('./models/Exam');
const Session = require('./models/Session');
const Violation = require('./models/Violation');
const Submission = require('./models/Submission');
const { ownsExam } = require('./middleware/examAccess');

const app = express();
// Local tunnel agents are the only trusted forwarding proxies in development.
app.set('trust proxy', 'loopback');
const server = http.createServer(app);

// Only the phone route relaxes CSP for local WASM.
app.use('/side-camera', require('./routes/sideCameraPage'));

// Global Security & Parser Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cookieParser());
const dashboardOrigin = process.env.DASHBOARD_URL || 'http://localhost:5173';
app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    if (!origin) {
        return callback(null, { origin: false, credentials: false });
    }
    if (origin === dashboardOrigin) {
        return callback(null, { origin: true, credentials: true });
    }
    // Electron file:// candidate renderer sends Origin: null and authenticates strictly via Bearer JWT (never cookies).
    // Never grant credentials: true to Origin: null to prevent sandboxed-iframe cookie theft.
    if (origin === 'null') {
        return callback(null, { origin: true, credentials: false });
    }
    return callback(null, { origin: false, credentials: false });
}));
app.use('/sessions/:sessionId/camera-verification', express.json({ limit: '2mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads (for screenshots, papers, verification photos, submissions)
app.use('/uploads', async (req, res, next) => {
    try {
        const headerToken = req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : null;
        const queryToken = typeof req.query.token === 'string' && req.query.token.trim()
            ? req.query.token.trim()
            : null;

        let decoded;
        if (headerToken) {
            try {
                decoded = verifyAccessToken(headerToken);
            } catch {
                decoded = verifyMediaToken(headerToken);
            }
        } else if (queryToken) {
            // Query-string tokens must be read-only media_read JWTs; reject full API access tokens in URLs
            decoded = verifyMediaToken(queryToken);
        } else {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const teacher = await Teacher.findById(decoded.teacherId);
        if (!teacher) return res.status(401).json({ error: 'Authentication required' });
        if (requireEmailVerification.needsVerification(teacher)) return res.status(403).json({ error: 'Email verification required', code: 'EMAIL_VERIFICATION_REQUIRED' });
        req.teacher = { teacherId: teacher._id.toString(), role: teacher.role };
        const folder = req.path.split('/')[1];
        const storedUrl = `/uploads${req.path}`;
        let examCode = null;
        if (folder === 'papers') {
            const filename = escapeRegex(path.basename(req.path));
            const exam = await Exam.findOne({ paperPath: new RegExp(filename + '$') });
            examCode = exam?.examCode;
        } else if (folder === 'screenshots' || folder === 'audio_clips') {
            const violation = await Violation.findOne({ 
                $or: [{ screenshotPath: storedUrl }, { audioPath: storedUrl }] 
            });
            const session = violation && await Session.findById(violation.sessionId);
            examCode = session?.examId;
        } else if (folder === 'verification') {
            const session = await Session.findOne({
                $or: [
                    { cameraVerificationPhoto: storedUrl },
                    { 'cameraPhotos.url': storedUrl },
                    { 'secondaryCamera.referencePhoto': storedUrl }
                ]
            });
            examCode = session?.examId;
        } else if (folder === 'submissions') {
            const submission = await Submission.findOne({ filePath: storedUrl });
            const session = submission && await Session.findById(submission.sessionId);
            examCode = session?.examId;
        }
        if (!examCode || !await ownsExam(req, examCode)) return res.status(404).json({ error: 'Asset not found' });

        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (folder === 'submissions') {
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            res.setHeader('Content-Disposition', 'attachment');
        }
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
app.use('/pairing', require('./routes/pairing'));
app.use('/auth', require('./routes/auth'));
app.use('/verification', require('./routes/verification'));
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
