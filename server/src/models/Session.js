const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    examId: { type: String, required: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    status: { 
        type: String, 
        enum: ["active", "completed", "terminated"], 
        default: "active" 
    },
    cameraVerificationPhoto: { type: String, default: null },
    cameraVerificationStatus: { 
        type: String, 
        enum: ["pending", "verified", "flagged", "none"], 
        default: "none" 
    },
    cameraVerificationNote: { type: String, default: null },
    terminationReason: { type: String, default: null },
    warnings: [{
        message: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }]
});

module.exports = mongoose.model('Session', sessionSchema);
