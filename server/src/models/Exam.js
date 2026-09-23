const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
    title: { type: String, required: true },
    examCode: { type: String, required: true, unique: true },
    examId: { type: String },
    createdBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Teacher',
        default: null 
    },
    createdByName: { 
        type: String, 
        default: 'Examiner' 
    },
    paperPath: { type: String, default: null },
    paperFilename: { type: String, default: null },
    status: { type: String, enum: ['draft', 'active', 'completed'], default: 'draft' },
    durationMinutes: { type: Number, default: 60 },
    extraMinutes: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    endTime: { type: Date, default: null },
    paperReleased: { type: Boolean, default: false },
    paperReleasedAt: { type: Date, default: null },
    rules: {
        detectCellPhone: { type: Boolean, default: true },
        detectMultiplePersons: { type: Boolean, default: true },
        enforceAppWhitelist: { type: Boolean, default: true },
        detectLookingAway: { type: Boolean, default: true },
        autoTerminateRiskScore: { type: Number, default: 80 }
    },
    allowedApplications: [{
        id: { type: String },
        name: { type: String },
        executable: { type: String, required: true },
        category: { type: String, default: 'General' }
    }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Exam', examSchema);
