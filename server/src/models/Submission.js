const mongoose = require('mongoose');
const submissionSchema = new mongoose.Schema({
    sessionId: String,
    filename: String,
    filePath: String,
    uploadedAt: Date
});
module.exports = mongoose.model('Submission', submissionSchema);
