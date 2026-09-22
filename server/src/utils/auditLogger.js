const AuditLog = require('../models/AuditLog');

/**
 * Records a teacher or administrative action in the audit trail.
 * @param {Object} req - Express request object (contains req.teacher and headers)
 * @param {Object} data - Audit payload
 * @param {string} data.action - Action constant (e.g. 'VIOLATION_REVIEWED')
 * @param {string} data.targetType - Target entity type ('violation', 'session', 'exam', 'storage_asset', etc.)
 * @param {string} [data.targetId] - Target identifier (e.g. violation ID, session ID)
 * @param {string} [data.targetSummary] - Human readable summary (e.g. 'Terminated Candidate: John Doe (SE-101)')
 * @param {Object} [data.details] - Detailed metadata or diff
 */
async function logTeacherAction(req, data) {
    try {
        const teacher = req?.teacher || {};
        const teacherId = teacher.teacherId || teacher._id || null;
        const teacherName = teacher.name || teacher.email || 'Examiner';
        const teacherEmail = teacher.email || 'system@integrityflow.local';

        const ipAddress = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 
                          req?.socket?.remoteAddress || 
                          req?.ip || 
                          '127.0.0.1';

        const entry = new AuditLog({
            teacherId,
            teacherName,
            teacherEmail,
            action: data.action,
            targetType: data.targetType || 'system',
            targetId: data.targetId ? String(data.targetId) : null,
            targetSummary: data.targetSummary || '',
            details: data.details || {},
            ipAddress,
            timestamp: new Date()
        });

        await entry.save();
        return entry;
    } catch (err) {
        console.error('[AuditLogger] Failed to write audit log entry:', err.message);
        return null;
    }
}

module.exports = {
    logTeacherAction
};
