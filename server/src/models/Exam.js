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
    rules: {
        detectCellPhone: { type: Boolean, default: true },
        detectMultiplePersons: { type: Boolean, default: true },
        enforceAppWhitelist: { type: Boolean, default: true },
        detectLookingAway: { type: Boolean, default: true },
        autoTerminateRiskScore: { type: Number, default: 80 }
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Exam', examSchema);
