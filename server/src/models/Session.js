const mongoose = require('mongoose');
const sessionSchema = new mongoose.Schema({
    studentId: String,
    examId: String,
    startTime: Date,
    endTime: Date,
    status: String
});
module.exports = mongoose.model('Session', sessionSchema);
