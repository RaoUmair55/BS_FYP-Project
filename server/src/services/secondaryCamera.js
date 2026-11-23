const { createHash } = require('node:crypto');
const Session = require('../models/Session');
const Exam = require('../models/Exam');
const Violation = require('../models/Violation');
const { calculateRiskScore } = require('../scoring/severityEngine');
const { authenticate } = require('../middleware/sessionAuth');

const LOST_AFTER_MS = 25000;
const SIDE_TYPES = ['secondary_camera_disconnected', 'secondary_camera_moved', 'secondary_camera_obstructed'];
// Single source of truth for phone-submitted side-camera violation types and their authoritative server severities.
const SIDE_UPLOAD_SEVERITY = {
    secondary_camera_moved: 3,
    secondary_camera_obstructed: 3,
    no_face_detected: 3,
    unauthorized_object: 4,
    cell_phone: 4,
    second_person_detected: 5
};
const validOrientation = o => o && ['alpha', 'beta', 'gamma'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k]) && Math.abs(o[k]) <= 360);
const laptopRoom = id => `side-laptop:${id}`;
const phoneRoom = id => `side-phone:${id}`;

async function publishStatus(io, session) {
    const sessionId = String(session._id), status = session.secondaryCamera?.status || 'not_paired';
    const fixedStandMode = session.secondaryCamera?.fixedStandMode === true;
    const referencePhoto = session.secondaryCamera?.referencePhoto || null;
    io.to(laptopRoom(sessionId)).emit('side-camera-status', { sessionId, status,
        placementVerified: session.secondaryCamera?.placementVerified === true, fixedStandMode });
    // Preview and placement data never enter teacher rooms. Status is owner-only, including for admins.
    const exam = await Exam.findOne({ $or: [{ examCode: session.examId }, { examId: session.examId }] });
    for (const socket of io.sockets.sockets.values()) {
        if (exam?.createdBy && socket.teacher?.id === String(exam.createdBy)) {
            socket.emit('secondaryCameraStatus', { sessionId, status, fixedStandMode, referencePhoto });
        }
    }
}

function requestDeskSnapshot(io, sessionId) {
    if (!io || !sessionId) return false;
    const room = phoneRoom(String(sessionId));
    const listeners = io.sockets?.adapter?.rooms?.get(room)?.size || 0;
    if (!listeners) return false;
    io.to(room).emit('request-desk-snapshot', { sessionId: String(sessionId), requestedAt: new Date().toISOString() });
    return true;
}

async function watchdog(io, now = new Date()) {
    const cutoff = new Date(+now - LOST_AFTER_MS);
    const sessions = await Session.find({ status: 'active', candidateMonitoringStartedAt: { $ne: null },
        'secondaryCamera.paired': true, 'secondaryCamera.status': { $ne: 'lost' }, 'secondaryCamera.lastHeartbeatAt': { $lt: cutoff }, $or: [{ 'secondaryCamera.disconnectedAt': null }, { 'secondaryCamera.disconnectedAt': { $lt: cutoff } }] });
    for (const session of sessions) {
        const exam = await Exam.findOne({ $or: [{ examCode: session.examId }, { examId: session.examId }] });
        if (!exam?.requireSecondaryCamera || exam.status !== 'active' || !exam.startedAt ||
            (exam.paperPath && !exam.paperReleased) || (exam.endTime && new Date(exam.endTime) <= now) ||
            (session.endTime && new Date(session.endTime) <= now)) continue;
        const claimed = await Session.findOneAndUpdate({ _id: session._id, status: 'active',
            'secondaryCamera.status': { $ne: 'lost' }, 'secondaryCamera.lastHeartbeatAt': { $lt: cutoff },
            $or: [{ 'secondaryCamera.disconnectedAt': null }, { 'secondaryCamera.disconnectedAt': { $lt: cutoff } }] },
        { $set: { 'secondaryCamera.status': 'lost' } }, { new: true });
        if (!claimed) continue;
        let persisted = false;
        try {
            const eventId = `side-lost-${+new Date(claimed.secondaryCamera.lastHeartbeatAt)}`;
            const id = createHash('sha256').update(String(session._id) + ':' + eventId).digest('hex').slice(0, 24);
            const violation = await Violation.findOneAndUpdate({ _id: id }, { $setOnInsert: {
                sessionId: String(session._id), eventId, type: SIDE_TYPES[0], source: 'side_camera', severity: 3,
                timestamp: now, details: { reason: 'No phone heartbeat for at least 25 seconds' }
            } }, { upsert: true, new: true, setDefaultsOnInsert: true });
            persisted = true;
            await publishStatus(io, claimed);
            const { broadcastViolation, broadcastRiskScoreUpdate } = require('../sockets/violationSocket');
            await broadcastViolation(io, violation.toObject());
            const score = await calculateRiskScore(session._id);
            await broadcastRiskScoreUpdate(io, String(session._id), score.riskScore);
        } catch (err) {
            // Leave the same event retryable if evidence persistence failed.
            if (!persisted) await Session.updateOne({ _id: session._id, 'secondaryCamera.lastHeartbeatAt': claimed.secondaryCamera.lastHeartbeatAt,
                'secondaryCamera.status': 'lost' }, { $set: { 'secondaryCamera.status': 'connected' } });
            console.error('Side camera watchdog could not persist alert:', err.message);
        }
    }
}

function attach(io) {
    const phones = new Map();
    io.on('connection', socket => {
        if (!socket.sessionClaims) return;
        const id = socket.sessionClaims.sessionId;
        const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(1, socket.sessionClaims.exp * 1000 - Date.now()));
        expiryTimer.unref(); socket.on('disconnect', () => clearTimeout(expiryTimer));
        if (socket.sessionClaims.scope === 'candidate_session') {
            socket.join(laptopRoom(id));
            publishStatus(io, socket.candidateSession).catch(() => {});
            return;
        }
        const previous = phones.get(id);
        phones.set(id, socket);
        previous?.disconnect(true);
        socket.join(`side-phone:${id}`);
        let verified = socket.candidateSession.secondaryCamera?.placementVerified === true;
        let frameWindow = 0, frameCount = 0, lastHeartbeatWrite = 0, lastPlacement = 0;
        const live = () => Date.now() < socket.sessionClaims.exp * 1000;
        const filter = { _id: id, status: 'active', 'secondaryCamera.credentialId': socket.sessionClaims.jti };
        const report = async () => {
            const session = await Session.findOneAndUpdate(filter, { $set: {
                'secondaryCamera.lastHeartbeatAt': new Date(), 'secondaryCamera.disconnectedAt': null, 'secondaryCamera.status': verified ? 'verified' : 'connected'
            } }, { new: true });
            if (!session) return socket.disconnect(true);
            await publishStatus(io, session);
        };
        socket.on('heartbeat', async (data, ack) => {
            if (!live() || !data || !validOrientation(data.orientation) || typeof data.trackLive !== 'boolean' ||
                !Number.isFinite(data.luminance) || data.luminance < 0 || data.luminance > 255) return;
            if (Date.now() - lastHeartbeatWrite < 3500) return;
            lastHeartbeatWrite = Date.now();
            try { await report(); if (typeof ack === 'function') ack({ ok: true }); } catch { /* Next heartbeat retries. */ }
        });
        socket.on('orientation', data => {
            if (live() && validOrientation(data)) socket.data.orientation = data;
        });
        socket.on('preview-frame', data => {
            if (!live() || verified || typeof data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data) ||
                Buffer.byteLength(data, 'utf8') > 60 * 1024 || !io.sockets.adapter.rooms.get(laptopRoom(id))?.size) return;
            const second = Math.floor(Date.now() / 1000);
            if (second !== frameWindow) { frameWindow = second; frameCount = 0; }
            if (++frameCount > 3) return;
            // Volatile delivery: no buffering, logging, persistence or replay of setup images.
            io.to(laptopRoom(id)).volatile.emit('preview-frame', { sessionId: id, frame: data });
        });
        socket.on('placement-result', async (data, ack) => {
            if (!live() || Date.now() - lastPlacement < 700 || !data || typeof data.verified !== 'boolean' ||
                !validOrientation(data.orientation) || !data.criteria ||
                !['person', 'workstation', 'lighting', 'steady'].every(k => typeof data.criteria[k] === 'boolean')) return;
            lastPlacement = Date.now();
            if (data.verified && !Object.values(data.criteria).every(v => v === true)) return;
            try {
                if (data.verified) {
                    const session = await Session.findOneAndUpdate(filter, { $set: {
                        'secondaryCamera.placementVerified': true, 'secondaryCamera.status': 'verified',
                        'secondaryCamera.fixedStandMode': data.fixedStandMode === true,
                        'secondaryCamera.lastHeartbeatAt': new Date() } }, { new: true });
                    if (!session) return socket.disconnect(true);
                    verified = true;
                    await publishStatus(io, session);
                }
                io.to(laptopRoom(id)).emit('placement-result', { sessionId: id, criteria: data.criteria, verified });
                if (typeof ack === 'function') ack({ ok: true, verified });
            } catch { /* Phone retries placement after reconnect. */ }
        });
        socket.on('disconnect', () => {
            if (phones.get(id) !== socket) return;
            phones.delete(id);
            Session.updateOne(filter, { $set: { 'secondaryCamera.disconnectedAt': new Date() } }).catch(() => {});
        });
        // Reconnect keeps the baseline and does not create a new incident inside the grace period.
        report().catch(() => socket.disconnect(true));
        socket.emit('side-camera-status', { sessionId: id, status: verified ? 'verified' : 'connected', placementVerified: verified });
    });
    let checking = false;
    const interval = setInterval(async () => {
        if (checking) return;
        checking = true;
        try { await watchdog(io); }
        catch (err) { console.error('Side camera watchdog:', err.message); }
        finally { checking = false; }
    }, 1000);
    interval.unref();
    io.httpServer?.once('close', () => clearInterval(interval));
}

async function socketAuth(socket, next) {
    try {
        const { decoded, session } = await authenticate(socket.handshake.auth?.token, socket.handshake.auth?.scope);
        if (!['candidate_session', 'secondary_camera'].includes(decoded.scope)) throw new Error('Invalid scope');
        socket.sessionClaims = decoded; socket.candidateSession = session; next();
    } catch { next(new Error('Invalid session credential')); }
}

module.exports = { attach, socketAuth, watchdog, publishStatus, requestDeskSnapshot, validOrientation, LOST_AFTER_MS, SIDE_TYPES, SIDE_UPLOAD_SEVERITY };
