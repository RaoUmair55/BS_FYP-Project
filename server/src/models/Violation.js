const mongoose = require('mongoose');
const violationSchema = new mongoose.Schema({
    sessionId: String,
    type: String,
    severity: Number,
    timestamp: String,
    details: {
        confidence: Number,
        duration: Number,
        object_class: String
    },
    screenshotPath: String
});
module.exports = mongoose.model('Violation', violationSchema);
