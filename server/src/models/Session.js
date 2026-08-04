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
    }
});

module.exports = mongoose.model('Session', sessionSchema);
