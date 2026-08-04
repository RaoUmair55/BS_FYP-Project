const mongoose = require('mongoose');
const examSchema = new mongoose.Schema({
    examId: String,
    paperPath: String,
    paperFilename: String,
    createdAt: Date
});
module.exports = mongoose.model('Exam', examSchema);
