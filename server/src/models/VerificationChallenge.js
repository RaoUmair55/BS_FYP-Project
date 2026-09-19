const mongoose = require('mongoose');

const verificationChallengeSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        required: true
    },
    codeHash: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    attempts: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

verificationChallengeSchema.index({ teacherId: 1, createdAt: -1 });

module.exports = mongoose.model('VerificationChallenge', verificationChallengeSchema);
