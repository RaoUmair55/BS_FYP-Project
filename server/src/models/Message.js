const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    examId: { type: String, required: true, index: true },
    sender: { type: String, enum: ['student', 'candidate', 'teacher'], required: true },
    senderName: { type: String, required: true },
    rollNumber: { type: String, default: '' },
    studentId: { type: String, default: '' },
    text: { type: String, required: true },
    isBroadcast: { type: Boolean, default: false },
    read: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
