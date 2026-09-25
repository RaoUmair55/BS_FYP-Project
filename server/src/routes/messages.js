const express = require('express');
const Message = require('../models/Message');
const Session = require('../models/Session');
const Exam = require('../models/Exam');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /messages — Send message (Candidate or Teacher)
 */
router.post('/messages', async (req, res) => {
    try {
        const { sessionId, examId, sender, senderName, rollNumber, studentId, text, isBroadcast } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Message text is required' });
        }

        if (!examId) {
            return res.status(400).json({ error: 'examId is required' });
        }

        const normalizedSender = (sender === 'teacher') ? 'teacher' : 'student';
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
                io.emit('examAnnouncement', saved);
            }
            io.emit('chatMessage', saved);
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

        const query = {
            $or: [
                { sessionId: sessionId },
                { sessionId: 'ALL' }
            ]
        };

        if (examId) {
            query.examId = examId.toUpperCase();
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
router.get('/exams/:examId/messages', requireAuth, async (req, res) => {
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
router.patch('/messages/:messageId/read', async (req, res) => {
    try {
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
