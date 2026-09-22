const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Teacher',
        default: null
    },
    teacherName: {
        type: String,
        default: 'Examiner'
    },
    teacherEmail: {
        type: String,
        default: 'unknown'
    },
    action: {
        type: String,
        required: true,
        index: true
    },
    targetType: {
        type: String,
        enum: ['violation', 'session', 'exam', 'storage_asset', 'rules', 'candidate', 'system'],
        required: true,
        index: true
    },
    targetId: {
        type: String,
        default: null
    },
    targetSummary: {
        type: String,
        default: ''
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    ipAddress: {
        type: String,
        default: '127.0.0.1'
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
});

auditLogSchema.index({ timestamp: -1, action: 1 });
auditLogSchema.index({ teacherEmail: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
