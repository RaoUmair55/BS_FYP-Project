const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    type: { 
        type: String, 
        required: true,
        enum: [
            "head_turn_away", 
            "second_person_detected", 
            "no_face_detected", 
            "unauthorized_object", 
            "unauthorized_app", 
            "cell_phone", 
            "camera_issue",
            "camera_occluded_or_dark",
            "usb_device_detected",
            "multiple_displays_detected"
        ]
    },
    severity: { type: Number, required: true, min: 1, max: 5 },
    timestamp: { type: Date, required: true },
    details: {
        confidence: { type: Number },
        duration: { type: Number },
        object_class: { type: String }
    },
    screenshotPath: { type: String },
    reviewed: { type: Boolean, default: false },
    reviewNote: { type: String, default: "" },
    decision: { type: String, enum: ["pending", "confirmed", "dismissed"], default: "pending" },
    reviewedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

// Compound and single-field performance indexes for high-concurrency proctoring queries
violationSchema.index({ sessionId: 1, timestamp: -1 });
violationSchema.index({ reviewed: 1 });
violationSchema.index({ sessionId: 1, reviewed: 1 });

module.exports = mongoose.model('Violation', violationSchema);

