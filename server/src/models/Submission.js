const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    submissionType: { type: String, enum: ['text', 'file', 'both'], default: 'text' },
    answerText: { type: String, default: '' },
    filename: { type: String, default: null },
    filePath: { type: String, default: null },
    fileSize: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Submission', submissionSchema);
