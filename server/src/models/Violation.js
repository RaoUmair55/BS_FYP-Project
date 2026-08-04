const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    type: { 
        type: String, 
        required: true,
        enum: ["head_turn_away", "second_person_detected", "no_face_detected", "unauthorized_object", "unauthorized_app"]
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
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Violation', violationSchema);
