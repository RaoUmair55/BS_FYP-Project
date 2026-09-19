const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        required: true
    },
    tokenHash: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    revoked: {
        type: Boolean,
        default: false
    }
});

// Index for fast lookup by tokenHash
refreshTokenSchema.index({ tokenHash: 1 });
refreshTokenSchema.index({ teacherId: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
