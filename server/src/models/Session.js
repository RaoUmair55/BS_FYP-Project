const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    studentName: { type: String, default: 'Candidate' },
    rollNumber: { type: String, default: 'N/A' },
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
    photoScheduleCreated: { type: Boolean, default: false },
    cameraPhotos: [{
        url: { type: String, required: true },
        capturedAt: { type: Date, default: Date.now },
        source: { type: String, enum: ['initial', 'requested', 'scheduled'], default: 'initial' },
        requestId: { type: String, default: null },
        status: { type: String, enum: ['pending', 'verified'], default: 'pending' },
        reviewedAt: { type: Date, default: null }
    }],
    cameraPhotoRequests: [{
        id: { type: String, required: true },
        source: { type: String, enum: ['requested', 'scheduled'], required: true },
        dueAt: { type: Date, required: true },
        note: { type: String, default: '' },
        completedAt: { type: Date, default: null }
    }],
    cameraVerificationNote: { type: String, default: null },
    terminationReason: { type: String, default: null },
    consentGiven: { type: Boolean, default: false },
    consentTimestamp: { type: Date, default: null },
    autoSubmitted: { type: Boolean, default: false },
    extraMinutes: { type: Number, default: 0 },
    warnings: [{
        message: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }]
});

// Compound index to support active session monitoring and historical exam queries
sessionSchema.index({ examId: 1, status: 1 });

module.exports = mongoose.model('Session', sessionSchema);

