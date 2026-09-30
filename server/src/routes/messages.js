const express = require('express');
const Message = require('../models/Message');
const Session = require('../models/Session');
const Exam = require('../models/Exam');
const { requireAuth } = require('../middleware/authMiddleware');
const { ownsExam, requireOwnedExam } = require('../middleware/examAccess');
const { broadcastToExam } = require('../sockets/violationSocket');

const router = express.Router();

/**
 * POST /messages — Send message (Candidate or Teacher)
 */
router.post('/messages', (req, res, next) => req.body?.sender === 'teacher' || req.body?.isBroadcast ? requireAuth(req, res, next) : next(), async (req, res) => {
    try {
        const { sessionId, examId, sender, senderName, rollNumber, studentId, text, isBroadcast } = req.body;

        if (typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'Message text is required' });
        }

        if (typeof examId !== 'string' || !examId.trim()) {
            return res.status(400).json({ error: 'examId is required' });
        }

        const normalizedSender = (sender === 'teacher') ? 'teacher' : 'student';
        if (normalizedSender === 'teacher' && !await ownsExam(req, examId)) return res.status(404).json({ error: 'Exam not found' });
        if (normalizedSender === 'student') {
            const session = sessionId && await Session.findById(sessionId);
            if (!session || session.status !== 'active' || session.examId.toUpperCase() !== examId.toUpperCase()) {
                return res.status(404).json({ error: 'Active session not found' });
            }
        }
        let resolvedName = senderName || (normalizedSender === 'teacher' ? 'Examiner' : 'Candidate');
        let resolvedRoll = rollNumber || '';
        let resolvedStudentId = studentId || '';

        // If sent by student/candidate, enrich from Session document if missing
        if (normalizedSender === 'student' && sessionId) {
            try {
                const session = await Session.findOne({ 
                    $or: [{ _id: sessionId.match(/^[0-9a-fA-F]{24}$/) ? sessionId : null }, { sessionId: sessionId }] 
                });
                if (session) {
                    resolvedName = session.studentName || resolvedName;
                    resolvedRoll = session.rollNumber || resolvedRoll;
                    resolvedStudentId = session.studentId || resolvedStudentId;
                }
            } catch (e) {}
        }

        const newMsg = new Message({
            sessionId: isBroadcast ? 'ALL' : (sessionId || 'ALL'),
            examId: examId.toUpperCase(),
            sender: normalizedSender,
            senderName: resolvedName,
            rollNumber: resolvedRoll,
            studentId: resolvedStudentId,
            text: text.trim(),
            isBroadcast: Boolean(isBroadcast),
            read: normalizedSender === 'teacher',
            timestamp: new Date()
        });

        const saved = await newMsg.save();

        // Broadcast real-time over WebSocket
        const io = req.app.locals.io;
        if (io) {
            if (saved.isBroadcast) {
                await broadcastToExam(io, saved.examId, 'examAnnouncement', saved);
            }
            await broadcastToExam(io, saved.examId, 'chatMessage', saved);
        }

        res.status(201).json({ success: true, message: saved, ...saved.toObject() });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message', details: err.message });
    }
});

/**
 * GET /messages/:sessionId — Get message thread for a candidate session
 */
router.get('/messages/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { examId } = req.query;

        let session = null;
        try {
            session = await Session.findOne({ 
                $or: [
                    { _id: sessionId.match(/^[0-9a-fA-F]{24}$/) ? sessionId : null }, 
                    { sessionId: sessionId }
                ] 
            });
        } catch (e) {}

        if (!session) return res.status(404).json({ error: 'Session not found' });
        const activeExamId = session.examId.toUpperCase();

        const query = {
            $or: [
                { sessionId: sessionId },
                { sessionId: 'ALL' }
            ]
        };

        if (activeExamId) {
            query.examId = activeExamId;
        }

        // Clean isolation: only include messages from this session's time window or later
        if (session && (session.startTime || session.createdAt)) {
            const startThreshold = new Date(new Date(session.startTime || session.createdAt).getTime() - 60000); // 1 minute pre-buffer
            query.timestamp = { $gte: startThreshold };
        }

        const messages = await Message.find(query).sort({ timestamp: 1 });
        res.json({ success: true, messages });
    } catch (err) {
        console.error('Error fetching session messages:', err);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

/**
 * GET /exams/:examId/messages — Get all messages for an entire exam (Teacher-facing)
 */
router.get('/exams/:examId/messages', requireAuth, requireOwnedExam, async (req, res) => {
    try {
        const { examId } = req.params;
        const messages = await Message.find({ examId: examId.toUpperCase() }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) {
        console.error('Error fetching exam messages:', err);
        res.status(500).json({ error: 'Failed to fetch exam messages' });
    }
});

/**
 * PATCH /messages/:messageId/read — Mark message as read
 */
router.patch('/messages/:messageId/read', requireAuth, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId);
        if (!message || !await ownsExam(req, message.examId)) return res.status(404).json({ error: 'Message not found' });
        const updated = await Message.findByIdAndUpdate(
            req.params.messageId, 
            { read: true }, 
            { new: true }
        );
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark message as read' });
    }
});

module.exports = router;
