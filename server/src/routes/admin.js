const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Teacher = require('../models/Teacher');
const Exam = require('../models/Exam');
const Session = require('../models/Session');
const Violation = require('../models/Violation');
const Submission = require('../models/Submission');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const storageService = require('../services/storage');
const { logTeacherAction } = require('../utils/auditLogger');

// All admin routes strictly require 'admin' role
router.use(requireAuth, requireRole('admin'));

/**
 * GET /admin/stats
 * Aggregates comprehensive system statistics, violation breakdown, activity timeline, and storage counts.
 */
router.get('/stats', async (req, res) => {
    try {
        const [
            totalExams,
            activeExams,
            totalSessions,
            activeSessions,
            terminatedSessions,
            completedSessions,
            totalViolations,
            pendingViolations,
            confirmedViolations,
            dismissedViolations,
            violationTypeAgg,
            severityAgg,
            recentViolationsTimeline,
            totalSubmissions
        ] = await Promise.all([
            Exam.countDocuments(),
            Exam.countDocuments({ status: 'active' }),
            Session.countDocuments(),
            Session.countDocuments({ status: 'active' }),
            Session.countDocuments({ status: 'terminated' }),
            Session.countDocuments({ status: 'completed' }),
            Violation.countDocuments(),
            Violation.countDocuments({ reviewed: false }),
            Violation.countDocuments({ decision: 'confirmed' }),
            Violation.countDocuments({ decision: 'dismissed' }),
            Violation.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            Violation.aggregate([
                { $group: { _id: '$severity', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Violation.aggregate([
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 14 }
            ]),
            Submission.countDocuments()
        ]);

        // Calculate storage asset counts
        const [papersCount, verificationCount, screenshotsCount, submissionsWithFileCount] = await Promise.all([
            Exam.countDocuments({ paperPath: { $ne: null, $exists: true } }),
            Session.countDocuments({ cameraVerificationPhoto: { $ne: null, $exists: true } }),
            Violation.countDocuments({ screenshotPath: { $ne: null, $exists: true } }),
            Submission.countDocuments({ fileUrl: { $ne: null, $exists: true } })
        ]);

        const totalAssets = papersCount + verificationCount + screenshotsCount + submissionsWithFileCount;

        // High risk candidate sessions (risk score >= 60)
        const highRiskSessionsCount = await Session.countDocuments({ riskScore: { $gte: 60 } });

        res.json({
            overview: {
                totalExams,
                activeExams,
                totalSessions,
                activeSessions,
                terminatedSessions,
                completedSessions,
                totalViolations,
                pendingViolations,
                confirmedViolations,
                dismissedViolations,
                highRiskSessionsCount,
                totalSubmissions
            },
            storage: {
                totalAssets,
                papersCount,
                verificationCount,
                screenshotsCount,
                submissionsCount: submissionsWithFileCount,
                provider: process.env.CLOUDINARY_CLOUD_NAME ? 'Cloudinary CDN' : 'Local Storage',
                cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'local'
            },
            violationBreakdown: violationTypeAgg.map(item => ({
                type: item._id || 'UNKNOWN',
                count: item.count
            })),
            severityBreakdown: severityAgg.map(item => ({
                severity: item._id,
                count: item.count
            })),
            activityTimeline: recentViolationsTimeline.reverse()
        });
    } catch (err) {
        console.error('[AdminStats] Error aggregating statistics:', err);
        res.status(500).json({ error: 'Failed to aggregate statistics', details: err.message });
    }
});

/**
 * GET /admin/assets
 * Lists all stored media and documents (papers, verification photos, screenshots, submissions) with search & filters.
 */
router.get('/assets', async (req, res) => {
    try {
        const { type = 'all', search = '', examId = '', page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

        let items = [];

        // 1. Fetch Question Papers
        if (type === 'all' || type === 'papers') {
            const query = { paperPath: { $ne: null, $exists: true } };
            if (examId) {
                query.$or = [{ examId: new RegExp('^' + examId + '$', 'i') }, { examCode: new RegExp('^' + examId + '$', 'i') }];
            }
            if (search) {
                query.$or = [
                    { title: new RegExp(search, 'i') },
                    { examCode: new RegExp(search, 'i') },
                    { paperFilename: new RegExp(search, 'i') }
                ];
            }
            const exams = await Exam.find(query).sort({ createdAt: -1 }).limit(200);
            exams.forEach(e => {
                items.push({
                    id: e._id.toString(),
                    assetType: 'paper',
                    title: `Exam Paper: ${e.title} (${e.examCode})`,
                    filename: e.paperFilename || 'question_paper.pdf',
                    url: e.paperPath,
                    createdAt: e.createdAt,
                    examId: e.examCode || e.examId,
                    examTitle: e.title,
                    candidateName: null,
                    rollNumber: null,
                    meta: { durationMinutes: e.durationMinutes, status: e.status }
                });
            });
        }

        // 2. Fetch Verification Photos
        if (type === 'all' || type === 'verification') {
            const query = { cameraVerificationPhoto: { $ne: null, $exists: true } };
            if (examId) {
                query.examId = new RegExp('^' + examId + '$', 'i');
            }
            if (search) {
                query.$or = [
                    { studentName: new RegExp(search, 'i') },
                    { rollNumber: new RegExp(search, 'i') },
                    { studentId: new RegExp(search, 'i') }
                ];
            }
            const sessions = await Session.find(query).sort({ createdAt: -1 }).limit(200);
            sessions.forEach(s => {
                items.push({
                    id: s._id.toString(),
                    assetType: 'verification',
                    title: `Verification Photo: ${s.studentName || 'Candidate'}`,
                    filename: `verify_${s._id}.jpg`,
                    url: s.cameraVerificationPhoto,
                    createdAt: s.createdAt,
                    examId: s.examId,
                    examTitle: s.examId,
                    candidateName: s.studentName || s.studentId || 'Candidate',
                    rollNumber: s.rollNumber || null,
                    meta: { verificationStatus: s.cameraVerificationStatus, sessionStatus: s.status, riskScore: s.riskScore }
                });
            });
        }

        // 3. Fetch Violation Screenshots
        if (type === 'all' || type === 'screenshots') {
            const query = { screenshotPath: { $ne: null, $exists: true } };
            const violations = await Violation.find(query).sort({ timestamp: -1 }).limit(200);
            
            // Collect sessionIds to populate student names
            const sessionIds = [...new Set(violations.map(v => v.sessionId).filter(Boolean))];
            const sessionDocs = await Session.find({ _id: { $in: sessionIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } });
            const sessionMap = new Map();
            sessionDocs.forEach(s => sessionMap.set(s._id.toString(), s));

            violations.forEach(v => {
                const s = sessionMap.get(v.sessionId);
                const candName = s?.studentName || s?.studentId || 'Candidate';
                const rollNum = s?.rollNumber || null;
                const examCode = s?.examId || 'EXAM';

                if (examId && examCode.toLowerCase() !== examId.toLowerCase()) {
                    return;
                }

                if (search) {
                    const searchLower = search.toLowerCase();
                    const matchType = (v.type || '').toLowerCase().includes(searchLower);
                    const matchName = candName.toLowerCase().includes(searchLower);
                    const matchRoll = (rollNum || '').toLowerCase().includes(searchLower);
                    if (!matchType && !matchName && !matchRoll) return;
                }

                items.push({
                    id: v._id.toString(),
                    assetType: 'screenshot',
                    title: `Violation Evidence: ${v.type}`,
                    filename: `violation_${v._id}.jpg`,
                    url: v.screenshotPath,
                    createdAt: v.timestamp,
                    examId: examCode,
                    examTitle: examCode,
                    candidateName: candName,
                    rollNumber: rollNum,
                    meta: { severity: v.severity, reviewed: v.reviewed, decision: v.decision, note: v.reviewNote }
                });
            });
        }

        // 4. Fetch Submissions
        if (type === 'all' || type === 'submissions') {
            const query = { fileUrl: { $ne: null, $exists: true } };
            if (examId) query.examId = new RegExp('^' + examId + '$', 'i');
            if (search) {
                query.$or = [
                    { studentName: new RegExp(search, 'i') },
                    { rollNumber: new RegExp(search, 'i') },
                    { originalFilename: new RegExp(search, 'i') }
                ];
            }
            const submissions = await Submission.find(query).sort({ submittedAt: -1 }).limit(200);
            submissions.forEach(sub => {
                items.push({
                    id: sub._id.toString(),
                    assetType: 'submission',
                    title: `Candidate Submission: ${sub.studentName || 'Candidate'}`,
                    filename: sub.originalFilename || 'submission.zip',
                    url: sub.fileUrl,
                    createdAt: sub.submittedAt,
                    examId: sub.examId,
                    examTitle: sub.examId,
                    candidateName: sub.studentName,
                    rollNumber: sub.rollNumber,
                    meta: { size: sub.fileSize, submissionStatus: sub.status }
                });
            });
        }

        // Sort all items descending by createdAt
        items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const totalItems = items.length;
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedItems = items.slice(startIndex, startIndex + limitNum);

        res.json({
            items: paginatedItems,
            total: totalItems,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalItems / limitNum)
        });
    } catch (err) {
        console.error('[AdminAssets] Error listing assets:', err);
        res.status(500).json({ error: 'Failed to list storage assets', details: err.message });
    }
});

/**
 * DELETE /admin/assets/:type/:id
 * Permanently deletes a single asset from Cloudinary/Storage and unlinks it from the database.
 */
router.delete('/assets/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        let deletedUrl = null;
        let targetSummary = '';

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: `Invalid ID: ${id}` });
        }

        const normalizedType = (type || '').toLowerCase();

        if (normalizedType === 'paper' || normalizedType === 'papers') {
            const exam = await Exam.findById(id);
            if (!exam) return res.status(404).json({ error: 'Exam not found' });
            deletedUrl = exam.paperPath;
            targetSummary = `Deleted Question Paper for Exam: ${exam.title || exam.examCode} (${exam.examCode})`;
            
            if (deletedUrl) {
                try {
                    await storageService.delete(deletedUrl);
                } catch (delErr) {
                    console.warn('[AdminDeleteAsset] Storage delete warning (paper):', delErr.message);
                }
            }
            await Exam.updateOne({ _id: id }, { $set: { paperPath: null, paperFilename: null } });
        } else if (normalizedType === 'screenshot' || normalizedType === 'screenshots') {
            const violation = await Violation.findById(id);
            if (!violation) return res.status(404).json({ error: 'Violation not found' });
            deletedUrl = violation.screenshotPath;
            targetSummary = `Deleted Screenshot for Violation: ${violation.type} (ID: ${violation._id})`;

            if (deletedUrl) {
                try {
                    await storageService.delete(deletedUrl);
                } catch (delErr) {
                    console.warn('[AdminDeleteAsset] Storage delete warning (screenshot):', delErr.message);
                }
            }
            await Violation.updateOne({ _id: id }, { $set: { screenshotPath: null } });
        } else if (normalizedType === 'verification' || normalizedType === 'verifications') {
            const session = await Session.findById(id);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            deletedUrl = session.cameraVerificationPhoto;
            targetSummary = `Deleted Verification Photo for Candidate: ${session.studentName || session.studentId}`;

            if (deletedUrl) {
                try {
                    await storageService.delete(deletedUrl);
                } catch (delErr) {
                    console.warn('[AdminDeleteAsset] Storage delete warning (verification):', delErr.message);
                }
            }
            await Session.updateOne({ _id: id }, { $set: { cameraVerificationPhoto: null } });
        } else if (normalizedType === 'submission' || normalizedType === 'submissions') {
            const sub = await Submission.findById(id);
            if (!sub) return res.status(404).json({ error: 'Submission not found' });
            deletedUrl = sub.fileUrl;
            targetSummary = `Deleted Submission file for Candidate: ${sub.studentName || 'Candidate'} (${sub.rollNumber || 'N/A'})`;

            if (deletedUrl) {
                try {
                    await storageService.delete(deletedUrl);
                } catch (delErr) {
                    console.warn('[AdminDeleteAsset] Storage delete warning (submission):', delErr.message);
                }
            }
            await Submission.updateOne({ _id: id }, { $set: { fileUrl: null } });
        } else {
            return res.status(400).json({ error: 'Invalid asset type. Expected: paper, screenshot, verification, submission' });
        }

        // Record Audit Log
        await logTeacherAction(req, {
            action: 'ASSET_DELETED',
            targetType: 'storage_asset',
            targetId: id,
            targetSummary,
            details: { assetType: normalizedType, deletedUrl }
        });

        res.json({ message: 'Asset permanently removed from storage and unlinked from database', id, type: normalizedType, deletedUrl });
    } catch (err) {
        console.error('[AdminDeleteAsset] Error deleting asset:', err);
        res.status(500).json({ error: 'Failed to delete asset', details: err.message });
    }
});

/**
 * POST /admin/assets/batch-delete
 * Batch deletes multiple assets from Cloudinary and cleans corresponding database entries.
 */
router.post('/assets/batch-delete', async (req, res) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items array is required for batch delete' });
        }

        let deletedCount = 0;
        const results = [];

        for (const item of items) {
            const { type, id } = item;
            const normalizedType = (type || '').toLowerCase();
            try {
                if (!mongoose.Types.ObjectId.isValid(id)) {
                    results.push({ id, type, success: false, error: 'Invalid ID' });
                    continue;
                }

                if (normalizedType === 'paper' || normalizedType === 'papers') {
                    const exam = await Exam.findById(id);
                    if (exam && exam.paperPath) {
                        try {
                            await storageService.delete(exam.paperPath);
                        } catch (e) {
                            console.warn('[AdminBatchDelete] Storage delete warning:', e.message);
                        }
                        await Exam.updateOne({ _id: id }, { $set: { paperPath: null, paperFilename: null } });
                        deletedCount++;
                        results.push({ id, type, success: true });
                    } else if (exam) {
                        results.push({ id, type, success: true, note: 'Already deleted' });
                    }
                } else if (normalizedType === 'screenshot' || normalizedType === 'screenshots') {
                    const violation = await Violation.findById(id);
                    if (violation && violation.screenshotPath) {
                        try {
                            await storageService.delete(violation.screenshotPath);
                        } catch (e) {
                            console.warn('[AdminBatchDelete] Storage delete warning:', e.message);
                        }
                        await Violation.updateOne({ _id: id }, { $set: { screenshotPath: null } });
                        deletedCount++;
                        results.push({ id, type, success: true });
                    } else if (violation) {
                        results.push({ id, type, success: true, note: 'Already deleted' });
                    }
                } else if (normalizedType === 'verification' || normalizedType === 'verifications') {
                    const session = await Session.findById(id);
                    if (session && session.cameraVerificationPhoto) {
                        try {
                            await storageService.delete(session.cameraVerificationPhoto);
                        } catch (e) {
                            console.warn('[AdminBatchDelete] Storage delete warning:', e.message);
                        }
                        await Session.updateOne({ _id: id }, { $set: { cameraVerificationPhoto: null } });
                        deletedCount++;
                        results.push({ id, type, success: true });
                    } else if (session) {
                        results.push({ id, type, success: true, note: 'Already deleted' });
                    }
                } else if (normalizedType === 'submission' || normalizedType === 'submissions') {
                    const sub = await Submission.findById(id);
                    if (sub && sub.fileUrl) {
                        try {
                            await storageService.delete(sub.fileUrl);
                        } catch (e) {
                            console.warn('[AdminBatchDelete] Storage delete warning:', e.message);
                        }
                        await Submission.updateOne({ _id: id }, { $set: { fileUrl: null } });
                        deletedCount++;
                        results.push({ id, type, success: true });
                    } else if (sub) {
                        results.push({ id, type, success: true, note: 'Already deleted' });
                    }
                }
            } catch (itemErr) {
                results.push({ id, type, success: false, error: itemErr.message });
            }
        }

        // Record Audit Log
        await logTeacherAction(req, {
            action: 'BATCH_ASSETS_DELETED',
            targetType: 'storage_asset',
            targetSummary: `Batch deleted ${deletedCount} storage assets`,
            details: { requestedCount: items.length, deletedCount, results }
        });

        res.json({ message: `Successfully deleted ${deletedCount} assets`, deletedCount, results });
    } catch (err) {
        console.error('[AdminBatchDelete] Error during batch delete:', err);
        res.status(500).json({ error: 'Batch delete failed', details: err.message });
    }
});

/**
 * POST /admin/assets/purge-exam
 * Purges all storage files (papers, verification photos, screenshots) for a given exam.
 */
router.post('/assets/purge-exam', async (req, res) => {
    try {
        const { examId, purgePapers = true, purgeScreenshots = true, purgeVerification = true } = req.body;
        if (!examId) {
            return res.status(400).json({ error: 'examId is required' });
        }

        const exam = await Exam.findOne({
            $or: [{ examId: new RegExp('^' + examId + '$', 'i') }, { examCode: new RegExp('^' + examId + '$', 'i') }]
        });

        let purgedPapers = 0;
        let purgedVerification = 0;
        let purgedScreenshots = 0;

        // 1. Purge Paper
        if (purgePapers && exam && exam.paperPath) {
            try {
                await storageService.delete(exam.paperPath);
            } catch (e) {
                console.warn('[AdminPurgeExam] Paper delete warning:', e.message);
            }
            await Exam.updateOne({ _id: exam._id }, { $set: { paperPath: null, paperFilename: null } });
            purgedPapers++;
        }

        // 2. Find sessions
        const sessions = await Session.find({ examId: new RegExp('^' + examId + '$', 'i') });
        const sessionIds = sessions.map(s => s._id.toString());

        // 3. Purge Verification photos
        if (purgeVerification) {
            for (const s of sessions) {
                if (s.cameraVerificationPhoto) {
                    try {
                        await storageService.delete(s.cameraVerificationPhoto);
                    } catch (e) {
                        console.warn('[AdminPurgeExam] Verification photo delete warning:', e.message);
                    }
                    await Session.updateOne({ _id: s._id }, { $set: { cameraVerificationPhoto: null } });
                    purgedVerification++;
                }
            }
        }

        // 4. Purge Violation screenshots
        if (purgeScreenshots && sessionIds.length > 0) {
            const violations = await Violation.find({ sessionId: { $in: sessionIds }, screenshotPath: { $ne: null } });
            for (const v of violations) {
                try {
                    await storageService.delete(v.screenshotPath);
                } catch (e) {
                    console.warn('[AdminPurgeExam] Screenshot delete warning:', e.message);
                }
                await Violation.updateOne({ _id: v._id }, { $set: { screenshotPath: null } });
                purgedScreenshots++;
            }
        }

        const totalPurged = purgedPapers + purgedVerification + purgedScreenshots;

        await logTeacherAction(req, {
            action: 'EXAM_ASSETS_PURGED',
            targetType: 'exam',
            targetId: examId,
            targetSummary: `Purged ${totalPurged} media files for Exam ${examId}`,
            details: { examId, purgedPapers, purgedVerification, purgedScreenshots, totalPurged }
        });

        res.json({
            message: `Purge completed for Exam ${examId}`,
            purgedPapers,
            purgedVerification,
            purgedScreenshots,
            totalPurged
        });
    } catch (err) {
        console.error('[AdminPurgeExam] Error purging exam media:', err);
        res.status(500).json({ error: 'Failed to purge exam media', details: err.message });
    }
});

/**
 * GET /admin/audit-logs
 * Retrieves paginated teacher and administrative audit logs with search and filters.
 */
router.get('/audit-logs', async (req, res) => {
    try {
        const { action = '', teacher = '', search = '', page = 1, limit = 50, startDate, endDate } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

        const query = {};
        if (action) query.action = action;
        if (teacher) {
            query.$or = [
                { teacherName: new RegExp(teacher, 'i') },
                { teacherEmail: new RegExp(teacher, 'i') }
            ];
        }
        if (search) {
            query.$or = [
                { targetSummary: new RegExp(search, 'i') },
                { action: new RegExp(search, 'i') },
                { teacherName: new RegExp(search, 'i') },
                { teacherEmail: new RegExp(search, 'i') }
            ];
        }
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const total = await AuditLog.countDocuments(query);
        const logs = await AuditLog.find(query)
            .sort({ timestamp: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum);

        res.json({
            logs,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (err) {
        console.error('[AdminAuditLogs] Error fetching audit logs:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs', details: err.message });
    }
});

/**
 * GET /admin/audit-logs/export
 * Exports all matching audit logs as a downloadable CSV.
 */
router.get('/audit-logs/export', async (req, res) => {
    try {
        const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(1000);
        
        let csv = 'Timestamp,Examiner Name,Examiner Email,Action,Target Type,Target ID,Summary,IP Address\n';
        logs.forEach(log => {
            const time = new Date(log.timestamp).toISOString();
            const teacherName = `"${(log.teacherName || '').replace(/"/g, '""')}"`;
            const teacherEmail = `"${(log.teacherEmail || '').replace(/"/g, '""')}"`;
            const action = `"${(log.action || '').replace(/"/g, '""')}"`;
            const targetType = `"${(log.targetType || '').replace(/"/g, '""')}"`;
            const targetId = `"${(log.targetId || '').replace(/"/g, '""')}"`;
            const summary = `"${(log.targetSummary || '').replace(/"/g, '""')}"`;
            const ip = `"${(log.ipAddress || '').replace(/"/g, '""')}"`;
            csv += `${time},${teacherName},${teacherEmail},${action},${targetType},${targetId},${summary},${ip}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="IntegrityFlow_Audit_Log_${Date.now()}.csv"`);
        res.status(200).send(csv);
    } catch (err) {
        console.error('[AdminAuditLogsExport] Export failed:', err);
        res.status(500).json({ error: 'Failed to export audit logs', details: err.message });
    }
});

/**
 * GET /admin/users
 * Lists all registered examiners/teachers and their roles.
 */
router.get('/users', async (req, res) => {
    try {
        const { search = '', role = '', page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

        const query = {};
        if (role) query.role = role;
        if (search) {
            query.$or = [
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') }
            ];
        }

        const total = await Teacher.countDocuments(query);
        const users = await Teacher.find(query)
            .select('-passwordHash')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum);

        // Enrich with exams count
        const enrichedUsers = await Promise.all(users.map(async (u) => {
            const examsCount = await Exam.countDocuments({ createdBy: u._id });
            return {
                id: u._id.toString(),
                name: u.name,
                email: u.email,
                role: u.role || 'teacher',
                emailVerified: u.emailVerified,
                createdAt: u.createdAt,
                examsCount
            };
        }));

        res.json({
            users: enrichedUsers,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (err) {
        console.error('[AdminUsers] Error listing users:', err);
        res.status(500).json({ error: 'Failed to list users', details: err.message });
    }
});

/**
 * PATCH /admin/users/:userId/role
 * Promotes or demotes an examiner/teacher role (e.g. 'admin' <-> 'teacher').
 */
router.patch('/users/:userId/role', async (req, res) => {
    try {
        const { role } = req.body;
        if (!['admin', 'teacher'].includes(role)) {
            return res.status(400).json({ error: 'Role must be "admin" or "teacher"' });
        }

        const targetUser = await Teacher.findById(req.params.userId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent admin from accidentally demoting themselves if they are the only admin
        const currentAdminId = req.teacher?.teacherId ? String(req.teacher.teacherId) : null;
        if (currentAdminId === String(targetUser._id) && role !== 'admin') {
            const adminCount = await Teacher.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot demote yourself: at least one active administrator must remain.' });
            }
        }

        const previousRole = targetUser.role;
        targetUser.role = role;
        await targetUser.save();

        // Record Teacher Action in Audit Log
        await logTeacherAction(req, {
            action: 'USER_ROLE_CHANGED',
            targetType: 'system',
            targetId: targetUser._id,
            targetSummary: `Changed role for "${targetUser.name}" (${targetUser.email}) from ${previousRole.toUpperCase()} to ${role.toUpperCase()}`,
            details: {
                userId: targetUser._id,
                userName: targetUser.name,
                userEmail: targetUser.email,
                previousRole,
                newRole: role
            }
        });

        res.json({
            message: `User role successfully updated to ${role}`,
            user: {
                id: targetUser._id,
                name: targetUser.name,
                email: targetUser.email,
                role: targetUser.role
            }
        });
    } catch (err) {
        console.error('[AdminUserRole] Error updating role:', err);
        res.status(500).json({ error: 'Failed to update user role', details: err.message });
    }
});

module.exports = router;
