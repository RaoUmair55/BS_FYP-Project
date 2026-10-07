const requireEmailVerification = require('../utils/emailVerification');
const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/tokens');
const Teacher = require('../models/Teacher');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const mongoose = require('mongoose');

function initSocket(server) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173';
    
    const io = new Server(server, {
        cors: {
            origin: dashboardUrl,
            methods: ["GET", "POST"]
        }
    });

    io.use(async (socket, next) => {
        try {
            const decoded = verifyAccessToken(socket.handshake.auth?.token);
            const teacher = await Teacher.findById(decoded.teacherId);
            if (!teacher) return next(new Error('Authentication required'));
            if (requireEmailVerification.needsVerification(teacher)) return next(new Error('Email verification required'));
            socket.teacher = { id: teacher._id.toString(), role: teacher.role };
            next();
        } catch (err) { next(new Error('Authentication required')); }
    });

    let connectedClients = 0;

    io.on('connection', (socket) => {
        connectedClients++;
        console.log(`Dashboard client connected. Connected clients: ${connectedClients}`);

        socket.on('disconnect', () => {
            connectedClients--;
            console.log(`Dashboard client disconnected. Connected clients: ${connectedClients}`);
        });
    });

    return io;
}

async function broadcastToExam(io, examCode, event, data) {
    if (!io || typeof examCode !== 'string' || !examCode) return;
    try {
        const literalCode = examCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const identifiers = [
            { examCode: new RegExp('^' + literalCode + '$', 'i') },
            { examId: new RegExp('^' + literalCode + '$', 'i') }
        ];
        if (mongoose.Types.ObjectId.isValid(examCode)) identifiers.push({ _id: examCode });
        const exam = await Exam.findOne({ 
            $or: identifiers
        }).select('createdBy');
        if (!exam) return;
        for (const socket of io.sockets.sockets.values()) {
            if (
                socket.teacher?.role === 'admin' || 
                (exam.createdBy && socket.teacher?.id === String(exam.createdBy))
            ) {
                socket.emit(event, data);
            }
        }
    } catch (err) { console.error('Socket broadcast failed:', err); }
}

async function broadcastForSession(io, sessionId, event, data) {
    try {
        const session = await Session.findById(sessionId);
        if (session) await broadcastToExam(io, session.examId, event, data);
    } catch (err) { console.error('Socket session lookup failed:', err); }
}

function broadcastViolation(io, violationDoc) {
    return broadcastForSession(io, violationDoc.sessionId, 'violation', violationDoc);
}

function broadcastRiskScoreUpdate(io, sessionId, riskScore) {
    return broadcastForSession(io, sessionId, 'riskScoreUpdate', { sessionId, riskScore });
}

function broadcastViolationReview(io, reviewData) {
    return broadcastForSession(io, reviewData.sessionId, 'violationReviewed', reviewData);
}

module.exports = {
    initSocket,
    broadcastViolation,
    broadcastRiskScoreUpdate,
    broadcastViolationReview,
    broadcastToExam
};
