const mongoose = require('mongoose');

const authAuditLogSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        default: null
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    event: {
        type: String,
        enum: [
            'signup',
            'login_success',
            'login_failed',
            'logout',
            'password_reset_requested',
            'password_reset_completed',
            'account_locked'
        ],
        required: true
    },
    ipAddress: {
        type: String,
        default: 'unknown'
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

authAuditLogSchema.index({ email: 1, timestamp: -1 });
authAuditLogSchema.index({ teacherId: 1, timestamp: -1 });

module.exports = mongoose.model('AuthAuditLog', authAuditLogSchema);
