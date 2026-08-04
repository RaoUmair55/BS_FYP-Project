const mongoose = require('mongoose');

const examSchema = new mongoose.Schema({
    examId: { type: String, required: true, unique: true },
    paperPath: { type: String },
    paperFilename: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Exam', examSchema);
