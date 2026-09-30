const Exam = require('../models/Exam');
const Session = require('../models/Session');
const { broadcastToExam } = require('../sockets/violationSocket');

/**
 * Automatically checks and expires active exams whose scheduled duration/endTime has passed.
 * - Transitions expired exams from status 'active' to 'completed'.
 * - Auto-completes any remaining active candidate sessions for that exam.
 * - Broadcasts live WebSocket event to open dashboards so UI refreshes immediately.
 * 
 * @param {Object} [io] - Socket.io server instance
 * @returns {Promise<Array<string>>} List of newly completed exam codes
 */
async function autoExpireFinishedExams(io = null) {
    try {
        const now = new Date();
        
        // Find active exams that have a valid endTime that has elapsed
        const expiredExams = await Exam.find({
            status: 'active',
            endTime: { $ne: null, $lte: now }
        });

        if (!expiredExams || expiredExams.length === 0) {
            return [];
        }

        const completedCodes = [];

        for (const exam of expiredExams) {
            exam.status = 'completed';
            await exam.save();
            const code = exam.examCode || exam.examId;
            completedCodes.push(code);

            // Auto-complete remaining active candidate sessions for this finished exam
            const codeRegex = new RegExp('^' + code + '$', 'i');
            await Session.updateMany(
                { examId: codeRegex, status: 'active' },
                {
                    status: 'completed',
                    autoSubmitted: true,
                    endTime: exam.endTime || now
                }
            );

            console.log(`[ExamLifecycle] Auto-completed expired exam: "${exam.title}" (${code}) at ${now.toISOString()}`);

            // Broadcast status change to connected examiner dashboards
            if (io) {
                await broadcastToExam(io, code, 'examStatusChanged', {
                    examCode: code,
                    status: 'completed',
                    reason: 'Exam duration elapsed'
                });
            }
        }

        return completedCodes;
    } catch (err) {
        console.error('[ExamLifecycle] Error auto-expiring finished exams:', err);
        return [];
    }
}

module.exports = { autoExpireFinishedExams };
