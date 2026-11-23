const router = require('express').Router();
const { randomBytes, createHash, randomUUID } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const Session = require('../models/Session');
const Exam = require('../models/Exam');
const storageService = require('../services/storage');
const { publishStatus } = require('../services/secondaryCamera');
const { requireSessionAuth, requireSideCameraAuth, signSessionToken } = require('../middleware/sessionAuth');
const { logTeacherAction } = require('../utils/auditLogger');

const referenceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 512 * 1024, files: 1, fields: 4 }
}).single('screenshot');

const hash = token => createHash('sha256').update(token).digest('hex');
// A classroom may share one public IP: allow normal pairing bursts while bounding token guessing.
const limit = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false });
const examFor = session => Exam.findOne({ $or: [{ examCode: session.examId }, { examId: session.examId }] });

router.post('/create', limit, requireSessionAuth, async (req, res) => {
    try {
        const publicUrl = new URL(process.env.PUBLIC_URL);
        if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') {
            return res.status(503).json({ error: 'PUBLIC_URL must be the public HTTPS backend origin' });
        }
        const exam = await examFor(req.candidateSession);
        if (!exam?.requireSecondaryCamera || exam.status !== 'active') return res.status(409).json({ error: 'Side camera is not required for this active exam' });
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60000);
        await Session.updateOne({ _id: req.candidateSession._id, status: 'active' }, { $set: {
            sideCameraPairing: { hash: hash(token), expiresAt, usedAt: null }
        } });
        await logTeacherAction(req, { action: 'SIDE_CAMERA_PAIRING_CREATED', targetType: 'session', targetId: req.candidateSession._id });
        const qrUrl = `${publicUrl.origin}/side-camera/?token=${token}`;
        const qrImage = await require('qrcode').toDataURL(qrUrl, { width: 256, margin: 2 });
        res.set('Cache-Control', 'no-store').json({ token, expiresAt, qrUrl, qrImage });
    } catch { res.status(503).json({ error: 'Pairing unavailable; check PUBLIC_URL and session configuration' }); }
});

router.post('/redeem', limit, async (req, res) => {
    try {
        if (typeof req.body.token !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.token)) return res.status(400).json({ error: 'Invalid pairing token' });
        // Validate signing configuration before consuming the one-time token.
        signSessionToken('configuration-check');
        const credentialId = randomUUID();
        const session = await Session.findOneAndUpdate({ 'sideCameraPairing.hash': hash(req.body.token),
            'sideCameraPairing.usedAt': null, 'sideCameraPairing.expiresAt': { $gt: new Date() }, status: 'active' },
        { $set: { 'sideCameraPairing.usedAt': new Date(), 'secondaryCamera.paired': true,
            'secondaryCamera.pairedAt': new Date(), 'secondaryCamera.lastHeartbeatAt': new Date(),
            'secondaryCamera.placementVerified': false, 'secondaryCamera.status': 'connected',
            'secondaryCamera.credentialId': credentialId } }, { new: true });
        if (!session) return res.status(401).json({ error: 'Pairing token expired, replaced or already used' });
        const exam = await examFor(session);
        if (!exam?.requireSecondaryCamera || exam.status !== 'active') return res.status(409).json({ error: 'Exam is no longer available' });
        await logTeacherAction(req, { action: 'SIDE_CAMERA_PAIRED', targetType: 'session', targetId: session._id });
        res.set('Cache-Control', 'no-store').json({ sessionId: String(session._id),
            token: signSessionToken(session._id, 'secondary_camera', { jti: credentialId }) });
    } catch { res.status(503).json({ error: 'Pairing unavailable; retry or generate a new QR code' }); }
});

router.post('/start', requireSessionAuth, async (req, res) => {
    try {
        const session = await Session.findById(req.candidateSession._id);
        const exam = await examFor(session);
        if (!exam || exam.status !== 'active' || (exam.endTime && new Date(exam.endTime) <= new Date())) return res.status(409).json({ error: 'Exam is not active' });
        if (exam?.requireSecondaryCamera && (!session.secondaryCamera?.placementVerified ||
            session.secondaryCamera.status !== 'verified' || Date.now() - new Date(session.secondaryCamera.lastHeartbeatAt).getTime() > 25000)) {
            return res.status(409).json({ error: 'Verify the side camera and restore its connection before beginning' });
        }
        if (req.body.prepare !== true) await Session.updateOne({ _id: session._id, status: 'active' }, { $set: { candidateMonitoringStartedAt: new Date() } });
        res.json({ success: true });
    } catch { res.status(503).json({ error: 'Cannot confirm monitoring readiness; retry' }); }
});

// POST /pairing/reference-photo — Save 1 clean desk baseline or examiner-requested desk check snapshot
router.post('/reference-photo', limit, requireSideCameraAuth, (req, res, next) => {
    referenceUpload(req, res, err => (err ? res.status(400).json({ error: 'One JPEG snapshot under 512 KB is required' }) : next()));
}, async (req, res) => {
    try {
        const session = req.candidateSession;
        if (!session || session.status !== 'active' || String(req.body.sessionId || '') !== String(session._id)) {
            return res.status(401).json({ error: 'Matching active side-camera session required' });
        }
        const exam = await examFor(session);
        if (!exam?.requireSecondaryCamera || exam.status !== 'active') {
            return res.status(409).json({ error: 'Exam is not active' });
        }
        const image = req.file;
        if (!image || image.mimetype !== 'image/jpeg' || image.buffer.length > 512 * 1024 ||
            image.buffer[0] !== 0xff || image.buffer[1] !== 0xd8) {
            return res.status(400).json({ error: 'One JPEG snapshot under 512 KB is required' });
        }
        const previousUrl = session.secondaryCamera?.referencePhoto || null;
        const filename = `${session._id}_side_desk_${randomUUID()}.jpg`;
        const saved = await storageService.save(image.buffer, filename, 'verification');
        const updated = await Session.findOneAndUpdate(
            { _id: session._id, status: 'active', 'secondaryCamera.credentialId': req.sessionClaims.jti },
            { $set: { 'secondaryCamera.referencePhoto': saved.url, 'secondaryCamera.referencePhotoAt': new Date() } },
            { new: true }
        );
        if (!updated) {
            await storageService.delete(saved.url).catch(() => {});
            return res.status(409).json({ error: 'Side-camera session no longer active' });
        }
        if (previousUrl && previousUrl !== saved.url) {
            await storageService.delete(previousUrl).catch(() => {});
        }
        if (req.app.locals.io) {
            await publishStatus(req.app.locals.io, updated);
        }
        res.status(201).json({ success: true, referencePhoto: saved.url, referencePhotoAt: updated.secondaryCamera.referencePhotoAt });
    } catch (err) {
        console.error('Error saving side-camera reference photo:', err.message);
        res.status(503).json({ error: 'Failed to save side-camera desk photo' });
    }
});

module.exports = router;
