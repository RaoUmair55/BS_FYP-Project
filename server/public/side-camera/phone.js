import { ObjectDetector, FilesetResolver } from './vendor/vision_bundle.mjs';
import { orientationDistance, tiltDistance, evaluatePersonFraming, placementCriteria, analyzeDeskFrame, SETUP_WORKSTATION_LABELS } from './rules.mjs';

// All local detection thresholds are deliberately visible for real-device calibration.
const PREVIEW_MS = 500, DETECTION_MS = 1000, HEARTBEAT_MS = 5000;
const PREVIEW_WIDTH = 480, JPEG_QUALITY = 0.5, MAX_PREVIEW_BYTES = 60 * 1024;
const MIN_LUMINANCE = 35, DARK_LUMINANCE = 18, FLAT_CONTRAST = 10, STEADY_DEGREES = 5, PLACEMENT_MS = 3000;
const HOLD_GRACE_MISSES = 1, WORKSTATION_ASSIST_DELAY_MS = 12000;
const MOVED_DEGREES = 10, MOVED_MS = 3000, MOVED_COOLDOWN_MS = 60000, OBSTRUCTED_MS = 5000;
const DETECTION_CONFIDENCE = 0.38, SENSOR_MAX_AGE_MS = 12000;
const AI_MONITOR_MS = 2500, AI_CONFIRM_CHECKS = 2, ABSENT_CONFIRM_CHECKS = 2, AI_COOLDOWN_MS = 60000;

const video = document.getElementById('camera'), button = document.getElementById('start');
const message = document.getElementById('message'), connection = document.getElementById('connection');
const canvas = document.createElement('canvas'), luminanceCanvas = document.createElement('canvas');
luminanceCanvas.width = 32; luminanceCanvas.height = 24;

const holdProgressBar = document.getElementById('hold-progress-bar');
const holdProgressContainer = document.getElementById('hold-progress-container');
const motionFallbackBox = document.getElementById('motion-fallback-box');
const fixedStandBtn = document.getElementById('btn-fixed-stand');
const workstationFallbackBox = document.getElementById('workstation-fallback-box');
const confirmWorkstationBtn = document.getElementById('btn-confirm-workstation');

let socket, stream, detector, wakeLock, token, sessionId, orientation = null, orientationAt = 0;
let baseline = null, verified = false, lastLuminance = 0, lastContrast = 50, holdSince = null, holdMisses = 0, samples = [];
let lastSetupDetections = [], lastPersonCheck = { ok: false, reason: 'missing' }, workstationMissingSince = null, workstationAssisted = false;
let movedSince = null, darkSince = null, lastMoved = -Infinity, obstructionReported = false;
let lastDetectTs = 0, lastAiScanAt = -Infinity, secondPersonChecks = 0, absentChecks = 0, objectStreak = { key: null, count: 0 };
const lastAiAlertAt = Object.create(null);
let running = false, starting = false, serverOffset = 0, lastPreview = 0, flushing = false;
let timers = [], pending = [], pendingVerification = false;
let sensorActive = false, fixedStandMode = false;
let pairingToken = new URL(location.href).searchParams.get('token');
history.replaceState(null, '', location.pathname); // Never leave the pairing secret in referrers or browser history URLs.

function trackLive() { return stream?.getVideoTracks()[0]?.readyState === 'live'; }

function readFrameStats() {
    if (!video.videoWidth || !trackLive()) return { luminance: lastLuminance, contrast: lastContrast };
    const ctx = luminanceCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 24);
    const pixels = ctx.getImageData(0, 0, 32, 24).data;
    const count = pixels.length / 4;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const y = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
        sum += y;
        sumSq += y * y;
    }
    const mean = sum / count;
    const variance = Math.max(0, (sumSq / count) - mean * mean);
    lastLuminance = mean;
    lastContrast = Math.sqrt(variance);
    return { luminance: lastLuminance, contrast: lastContrast };
}

function readLuminance() { return readFrameStats().luminance; }

function detectVideoFrame(now) {
    // MediaPipe VIDEO mode requires strictly increasing integer millisecond timestamps.
    const ts = Math.max(lastDetectTs + 1, Math.round(now));
    lastDetectTs = ts;
    return detector.detectForVideo(video, ts).detections || [];
}

function snapshot(withOverlay = false) {
    if (video.videoWidth && trackLive()) {
        canvas.width = PREVIEW_WIDTH; canvas.height = Math.round(video.videoHeight * PREVIEW_WIDTH / video.videoWidth);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Draw subtle AI guide boxes ONLY on transient setup preview sent to laptop (never on saved evidence).
        if (withOverlay && !verified && lastSetupDetections.length && typeof ctx.strokeRect === 'function') {
            const sx = canvas.width / video.videoWidth;
            const sy = canvas.height / video.videoHeight;
            for (const d of lastSetupDetections) {
                const name = d?.categories?.[0]?.categoryName?.toLowerCase() || '';
                const b = d?.boundingBox;
                if (!b || (name !== 'person' && !SETUP_WORKSTATION_LABELS.includes(name))) continue;
                const isPerson = name === 'person';
                const x = Math.max(2, b.originX * sx);
                const y = Math.max(2, b.originY * sy);
                const w = Math.min(canvas.width - x - 2, b.width * sx);
                const h = Math.min(canvas.height - y - 2, b.height * sy);
                ctx.lineWidth = 2;
                const personBad = isPerson && !lastPersonCheck.ok;
                ctx.strokeStyle = personBad ? '#f59e0b' : isPerson ? '#10b981' : '#38bdf8';
                ctx.strokeRect(x, y, w, h);
                if (typeof ctx.fillRect === 'function' && typeof ctx.fillText === 'function') {
                    const label = isPerson
                        ? (lastPersonCheck.reason === 'head_clipped' ? 'Head cut off - tilt up' : lastPersonCheck.ok ? 'Person OK' : 'Adjust framing')
                        : 'Workstation';
                    ctx.font = 'bold 11px sans-serif';
                    ctx.fillStyle = personBad ? 'rgba(245, 158, 11, 0.9)' : isPerson ? 'rgba(16, 185, 129, 0.85)' : 'rgba(14, 165, 233, 0.85)';
                    ctx.fillRect(x, Math.max(0, y - 16), label.length * 7 + 10, 16);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(label, x + 5, Math.max(12, y - 4));
                }
            }
        }
    }
    return canvas.width ? canvas.toDataURL('image/jpeg', JPEG_QUALITY) : null;
}

async function acquireWakeLock() {
    if (navigator.wakeLock && running && document.visibilityState === 'visible') {
        try { wakeLock = await navigator.wakeLock.request('screen'); }
        catch { message.textContent = 'Keep the screen awake manually; screen wake lock was unavailable.'; }
    }
}

function saveState() {
    sessionStorage.setItem('integrity-side-camera', JSON.stringify({ token, sessionId, baseline, verified, serverOffset, fixedStandMode }));
}

function heartbeat() {
    if (!socket?.connected || !orientation) return;
    socket.emit('orientation', orientation);
    socket.emit('heartbeat', { orientation, luminance: readLuminance(), trackLive: trackLive() });
}

function dataUrlToBlob(dataUrl) {
    // Convert data URL synchronously without fetch('data:...') so strict CSP connect-src 'self' never blocks uploads.
    const comma = dataUrl.indexOf(',');
    const meta = comma > 0 ? dataUrl.slice(0, comma) : '';
    const mimeMatch = /^data:([^;]+);base64$/i.exec(meta);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(comma > 0 ? dataUrl.slice(comma + 1) : dataUrl);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

async function flushEvidence() {
    if (flushing || !socket?.connected || !pending.length) return;
    flushing = true;
    let delivered = false;
    try {
        const event = pending[0], form = new FormData();
        for (const [key, value] of Object.entries(event.payload)) form.append(key, typeof value === 'object' ? JSON.stringify(value) : value);
        form.append('screenshot', event.blob, 'side-camera.jpg');
        const response = await fetch('/violation', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(10000) });
        if (response.ok) { pending.shift(); delivered = true; connection.textContent = 'Connected · snapshot delivered'; }
        else if (response.status < 500 && response.status !== 429) {
            pending.shift(); delivered = true; connection.textContent = response.status === 409 ? 'Waiting for the exam to begin' : 'Snapshot rejected. Ask your examiner to check the session.';
        }
    } catch { connection.textContent = 'Offline · snapshot waiting to retry. Keep this page open.'; }
    finally { flushing = false; }
    if (delivered && pending.length) flushEvidence();
}

async function uploadReferencePhoto(source = 'initial') {
    const image = snapshot(false);
    if (!image || !token || !sessionId) return;
    try {
        const blob = dataUrlToBlob(image);
        const form = new FormData();
        form.append('sessionId', sessionId);
        form.append('source', source);
        form.append('screenshot', blob, 'desk-baseline.jpg');
        const res = await fetch('/pairing/reference-photo', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
            connection.textContent = source === 'requested'
                ? 'Connected · desk check photo delivered'
                : 'Connected · desk baseline photo saved';
        } else {
            connection.textContent = `Desk photo rejected (${res.status})`;
        }
    } catch (err) {
        console.warn('Reference photo upload failed:', err);
        connection.textContent = 'Desk photo upload failed — keep this page open.';
    }
}

async function violation(type, reason, extraDetails = {}, severity = 3) {
    const image = snapshot(false);
    if (!image) { connection.textContent = 'No camera frame available. Restore the camera and inform the examiner.'; return; }
    if (pending.length >= 5) { connection.textContent = 'Connection unavailable; evidence queue full. Inform the examiner.'; return; }
    try {
        const blob = dataUrlToBlob(image);
        pending.push({ payload: { sessionId, source: 'side_camera', type, severity,
            timestamp: new Date(Date.now() + serverOffset).toISOString(), eventId: crypto.randomUUID(),
            details: { reason, ...extraDetails } }, blob });
        flushEvidence();
    } catch (err) {
        console.error('Failed to prepare side-camera snapshot:', err);
        connection.textContent = 'Could not capture snapshot frame.';
    }
}

function commitVerification() {
    if (!socket?.connected || !baseline) return;
    socket.emit('placement-result', { verified: true, orientation: baseline, fixedStandMode,
        criteria: { person: true, workstation: true, lighting: true, steady: true } }, result => {
        if (!result?.verified) return;
        pendingVerification = false; verified = true; saveState();
        if (holdProgressContainer) holdProgressContainer.hidden = true;
        if (motionFallbackBox) motionFallbackBox.hidden = true;
        if (workstationFallbackBox) workstationFallbackBox.hidden = true;
        lastSetupDetections = [];
        message.textContent = 'Placement verified. Desk AI monitoring is active. Keep this page open.';
        document.getElementById('criteria').textContent = 'Placement verified · Setup preview stopped · Desk AI active';
        uploadReferencePhoto('initial');
        heartbeat();
    });
}

function setOrientationValues(rawA, rawB, rawG) {
    const alpha = (typeof rawA === 'number' && Number.isFinite(rawA)) ? rawA : 0;
    const beta = (typeof rawB === 'number' && Number.isFinite(rawB)) ? rawB : 0;
    const gamma = (typeof rawG === 'number' && Number.isFinite(rawG)) ? rawG : 0;
    orientation = { alpha, beta, gamma };
    orientationAt = performance.now();
    sensorActive = true;
    if (motionFallbackBox) motionFallbackBox.hidden = true;
}

if (fixedStandBtn) {
    fixedStandBtn.addEventListener('click', () => {
        fixedStandMode = true;
        setOrientationValues(0, 90, 0);
        if (motionFallbackBox) motionFallbackBox.hidden = true;
        message.textContent = 'Fixed Stand Mode enabled. Continue positioning the camera.';
    });
}

if (confirmWorkstationBtn) {
    confirmWorkstationBtn.addEventListener('click', () => {
        workstationAssisted = true;
        if (workstationFallbackBox) workstationFallbackBox.hidden = true;
        message.textContent = 'Workstation confirmed. Hold steady for 3 seconds to lock placement.';
    });
}

function inspect() {
    if (!running) return;
    const now = performance.now();
    const { luminance, contrast } = readFrameStats();

    const hasRecentOrientation = Boolean(orientation && (now - orientationAt <= SENSOR_MAX_AGE_MS || fixedStandMode));
    if (!hasRecentOrientation && !fixedStandMode) {
        if (motionFallbackBox) motionFallbackBox.hidden = false;
        // Keep default orientation so detector can still analyze person & laptop
        if (!orientation) orientation = { alpha: 0, beta: 0, gamma: 0 };
    } else {
        if (motionFallbackBox) motionFallbackBox.hidden = true;
    }

    if (!verified) {
        if (pendingVerification) { commitVerification(); return; }
        if (!video.videoWidth || !trackLive()) return;

        samples.push({ at: now, value: { ...orientation } });
        samples = samples.filter(s => now - s.at <= PLACEMENT_MS);
        const steady = samples.every(s => tiltDistance(s.value, orientation) < STEADY_DEGREES);
        
        let detections = [];
        if (detector) {
            try {
                detections = detectVideoFrame(now);
            } catch (err) {
                console.warn('Detection frame skip:', err);
            }
        }
        lastSetupDetections = detections;
        lastPersonCheck = evaluatePersonFraming(detections, video.videoWidth, video.videoHeight);

        const rawCriteria = placementCriteria(detections, video.videoWidth, video.videoHeight,
            luminance, orientation, steady || fixedStandMode, MIN_LUMINANCE);
        const criteria = { ...rawCriteria, workstation: rawCriteria.workstation || workstationAssisted };

        // Offer assisted workstation confirm after 12s if only side-angled laptop AI is missing.
        if (rawCriteria.person && rawCriteria.lighting && rawCriteria.steady && !criteria.workstation) {
            workstationMissingSince ??= now;
            if (workstationFallbackBox && now - workstationMissingSince >= WORKSTATION_ASSIST_DELAY_MS) {
                workstationFallbackBox.hidden = false;
            }
        } else {
            workstationMissingSince = null;
            if (workstationFallbackBox) workstationFallbackBox.hidden = true;
        }
        
        const allPass = Object.values(criteria).every(Boolean);
        if (allPass) {
            holdSince ??= now;
            holdMisses = 0;
        } else if (holdSince !== null && holdMisses < HOLD_GRACE_MISSES) {
            holdMisses += 1;
        } else {
            holdSince = null;
            holdMisses = 0;
        }
        const passed = allPass && holdSince !== null && now - holdSince >= PLACEMENT_MS;

        // Visual Countdown & Progress Bar
        if (holdProgressContainer && holdProgressBar) {
            if (holdSince !== null) {
                holdProgressContainer.hidden = false;
                const elapsed = now - holdSince;
                const pct = Math.min(100, Math.round((elapsed / PLACEMENT_MS) * 100));
                if (holdProgressBar.style) holdProgressBar.style.width = pct + '%';
                const remaining = Math.max(0, ((PLACEMENT_MS - elapsed) / 1000)).toFixed(1);
                message.textContent = `Great placement! Hold steady for ${remaining}s…`;
            } else {
                holdProgressContainer.hidden = true;
                if (holdProgressBar.style) holdProgressBar.style.width = '0%';
                if (!criteria.lighting) {
                    message.textContent = 'Too dark: turn on a desk lamp or room light.';
                } else if (!criteria.person && lastPersonCheck.reason === 'head_clipped') {
                    message.textContent = 'Your head is cut off at the top — tilt the phone slightly up or move it back.';
                } else if (!criteria.person && lastPersonCheck.reason === 'too_close') {
                    message.textContent = 'Camera is too close — move the phone further back on your desk.';
                } else if (!criteria.person && lastPersonCheck.reason === 'too_small') {
                    message.textContent = 'Move slightly closer or angle the camera so your head and upper body fill more of the frame.';
                } else if (!criteria.person && !criteria.workstation) {
                    message.textContent = 'Point the rear camera toward you and your laptop on the desk.';
                } else if (!criteria.person) {
                    message.textContent = 'Laptop detected — angle slightly back so your head and upper body are fully in view.';
                } else if (!criteria.workstation) {
                    message.textContent = 'You are in view — angle slightly toward your laptop or keyboard.';
                } else if (!criteria.steady) {
                    message.textContent = 'Rest the phone steadily against books or a stand.';
                }
            }
        }

        const personFailLabel = lastPersonCheck.reason === 'head_clipped'
            ? 'Adjust · Head cut off at top — tilt camera slightly up'
            : lastPersonCheck.reason === 'too_close'
            ? 'Adjust · Too close — move phone slightly further back'
            : 'Adjust · Keep your full head & upper body in frame';

        const labels = {
            person: criteria.person ? 'OK · Head & upper body clearly in frame' : personFailLabel,
            workstation: criteria.workstation ? 'OK · Laptop / workspace visible on desk' : 'Adjust · Angle slightly toward laptop or keyboard',
            lighting: criteria.lighting ? 'OK · Enough light on desk' : 'Adjust · Increase lighting around desk',
            steady: criteria.steady ? 'OK · Phone resting steadily' : 'Adjust · Rest phone steadily on books or a stand'
        };

        const list = document.getElementById('criteria');
        if (list) {
            list.replaceChildren();
            for (const [key, ok] of Object.entries(criteria)) {
                const item = document.createElement('li');
                item.className = ok ? 'pass' : 'fail';
                item.textContent = labels[key];
                list.append(item);
            }
        }

        socket?.emit('placement-result', { verified: false, criteria, orientation });
        
        if (passed) {
            baseline = { ...orientation };
            pendingVerification = true;
            commitVerification();
        }
        return;
    }

    if (baseline && orientation && !fixedStandMode && orientationDistance(baseline, orientation) > MOVED_DEGREES) {
        movedSince ??= now;
        if (now - movedSince > MOVED_MS && now - lastMoved >= MOVED_COOLDOWN_MS) {
            lastMoved = now;
            violation('secondary_camera_moved', 'Phone moved more than 10 degrees from verified placement for over 3 seconds');
        }
    } else {
        movedSince = null;
    }

    const isDark = luminance < DARK_LUMINANCE;
    const isFlatBlocked = contrast < FLAT_CONTRAST;
    const statusList = document.getElementById('criteria');

    if (!trackLive() || isDark || isFlatBlocked) {
        darkSince ??= now;
        const elapsedSec = ((now - darkSince) / 1000).toFixed(1);
        if (statusList) statusList.textContent = `Camera obstructed (${elapsedSec}s / 5s) · Light: ${Math.round(luminance)} · Contrast: ${Math.round(contrast)}`;
        if (!obstructionReported && (!trackLive() || now - darkSince > OBSTRUCTED_MS)) {
            obstructionReported = true;
            const reason = !trackLive()
                ? 'Camera video track ended; snapshot is the last available frame'
                : isDark
                ? 'Camera view near black for over 5 seconds'
                : 'Camera lens blocked / covered by flat object (e.g. paper or hand) for over 5 seconds';
            violation('secondary_camera_obstructed', reason);
        }
        return;
    } else {
        darkSince = null;
        obstructionReported = false;
    }

    // Part 2: Low-frequency on-phone desk AI monitoring (~1 scan every 2.5s, 2-check confirmation, 60s cooldown)
    if (detector && video.videoWidth && now - lastAiScanAt >= AI_MONITOR_MS) {
        lastAiScanAt = now;
        let detections = [];
        try {
            detections = detectVideoFrame(now);
        } catch (err) {
            console.warn('Part-2 AI scan failed:', err);
            if (statusList) statusList.textContent = 'Desk AI scan retrying…';
            return;
        }
        const frame = analyzeDeskFrame(detections, video.videoWidth, video.videoHeight);

        const triggerWithCooldown = (key, type, reason, details, severity) => {
            if (now - (lastAiAlertAt[key] ?? -Infinity) < AI_COOLDOWN_MS) return;
            lastAiAlertAt[key] = now;
            violation(type, reason, details, severity);
        };

        if (frame.secondPerson) {
            if (++secondPersonChecks >= AI_CONFIRM_CHECKS) {
                triggerWithCooldown(
                    'second_person',
                    'second_person_detected',
                    `Second person detected beside the exam desk (${frame.personCount} people in side frame)`,
                    { person_count: frame.personCount },
                    5
                );
            }
        } else {
            secondPersonChecks = 0;
        }

        if (frame.personAbsent) {
            if (++absentChecks >= ABSENT_CONFIRM_CHECKS) {
                const absentReason = frame.workstationVisible
                    ? 'Candidate left the desk / absent from side-camera view'
                    : 'Candidate and workspace absent from side-camera view (camera turned or blocked)';
                triggerWithCooldown(
                    'person_absent',
                    'no_face_detected',
                    absentReason,
                    { person_count: 0, workstation_visible: frame.workstationVisible },
                    3
                );
            }
        } else {
            absentChecks = 0;
        }

        if (frame.unauthorizedObject) {
            const obj = frame.unauthorizedObject;
            const key = `obj:${obj.objectClass}`;
            objectStreak = objectStreak.key === key
                ? { key, count: objectStreak.count + 1 }
                : { key, count: 1 };
            if (objectStreak.count >= AI_CONFIRM_CHECKS) {
                triggerWithCooldown(
                    key,
                    obj.type,
                    `Unauthorized ${obj.objectClass} detected on desk from side camera`,
                    { object_class: obj.objectClass, confidence: Number(obj.confidence.toFixed(2)) },
                    obj.severity
                );
            }
        } else {
            objectStreak = { key: null, count: 0 };
        }

        if (statusList) {
            const alertNote = frame.secondPerson
                ? `2nd person (${secondPersonChecks}/${AI_CONFIRM_CHECKS})`
                : frame.unauthorizedObject
                ? `${frame.unauthorizedObject.objectClass} (${objectStreak.count}/${AI_CONFIRM_CHECKS})`
                : frame.personAbsent
                ? `No person in view (${absentChecks}/${ABSENT_CONFIRM_CHECKS})`
                : 'Desk clear';
            statusList.textContent = `Desk AI active · People: ${frame.personCount} · ${alertNote}`;
        }
    }
}

button.addEventListener('click', async () => {
    if (starting || running) return;
    starting = true; button.disabled = true; message.textContent = 'Requesting camera and motion permissions…';
    
    // Invoke permission APIs inside this tap before any network awaits, particularly on iOS.
    const motionRequest = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
        ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
    
    const cameraRequest = navigator.mediaDevices?.getUserMedia({
        video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 16 / 9 }
        },
        audio: false
    });
    
    const wakeRequest = navigator.wakeLock?.request('screen').catch(() => null);
    
    try {
        if (!cameraRequest) throw new Error('A public HTTPS address and a camera-capable browser are required.');
        const permissions = await Promise.allSettled([motionRequest, cameraRequest]);
        if (permissions[1].status === 'fulfilled') stream = permissions[1].value;
        if (permissions[1].status !== 'fulfilled') throw permissions[1].reason;
        
        if (permissions[0].status === 'fulfilled' && permissions[0].value === 'granted') {
            sensorActive = true;
        } else {
            console.warn('Motion sensor permission rejected or not supported. Stand mode will be available.');
        }

        wakeLock = await wakeRequest;
        
        if (pairingToken) {
            const response = await fetch('/pairing/redeem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: pairingToken }),
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Pairing failed. Request a new QR code.');
            const paired = await response.json();
            token = paired.token;
            sessionId = paired.sessionId;
            serverOffset = Date.parse(response.headers.get('Date')) - Date.now();
            if (!Number.isFinite(serverOffset)) serverOffset = 0;
            pairingToken = null;
            saveState();
        } else {
            const saved = JSON.parse(sessionStorage.getItem('integrity-side-camera') || '{}');
            ({ token, sessionId, baseline, verified, serverOffset = 0, fixedStandMode = false } = saved);
            if (!token || !sessionId) throw new Error('Scan a fresh QR code from the candidate laptop.');
        }

        video.srcObject = stream;
        await video.play();

        message.textContent = 'Loading on-device desk AI model…';
        const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
        detector = await ObjectDetector.createFromOptions(files, {
            baseOptions: { modelAssetPath: './models/efficientdet_lite0.tflite' },
            runningMode: 'VIDEO',
            scoreThreshold: DETECTION_CONFIDENCE,
            maxResults: 10
        });

        socket = window.io({
            auth: { token, scope: 'secondary_camera' },
            reconnection: true,
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            connection.textContent = 'Connected to IntegrityFlow';
            heartbeat();
            if (pendingVerification) commitVerification();
        });
        socket.on('disconnect', () => { connection.textContent = 'Connection lost · reconnecting. Keep the page open.'; });
        socket.on('connect_error', error => { connection.textContent = 'Cannot connect: ' + error.message + '. A new QR code may be needed.'; });
        socket.on('side-camera-status', state => {
            if (!state.placementVerified && verified) {
                verified = false; baseline = null; saveState(); location.reload();
            }
        });
        socket.on('request-desk-snapshot', () => {
            if (running && trackLive()) uploadReferencePhoto('requested');
        });

        running = true;
        document.getElementById('monitor').hidden = false;
        document.getElementById('instructions').hidden = true;
        button.hidden = true;

        timers = [
            setInterval(() => {
                if (verified || pendingVerification || !socket?.connected || performance.now() - lastPreview < PREVIEW_MS) return;
                const image = snapshot(true);
                if (image && image.length <= MAX_PREVIEW_BYTES) socket.volatile.emit('preview-frame', image);
                lastPreview = performance.now();
            }, PREVIEW_MS),
            setInterval(() => {
                try { inspect(); }
                catch (err) { console.error('Inspect error:', err); message.textContent = 'Placement analysis running…'; }
            }, DETECTION_MS),
            setInterval(heartbeat, HEARTBEAT_MS),
            setInterval(flushEvidence, 10000)
        ];

        message.textContent = verified ? 'Monitoring resumed. Keep this page open.' : 'Position the phone and check the 4 criteria below.';
        acquireWakeLock();
    } catch (error) {
        running = false;
        timers.forEach(clearInterval);
        timers = [];
        stream?.getTracks().forEach(track => track.stop());
        socket?.disconnect();
        detector?.close();
        const acquiredLock = wakeLock || await wakeRequest;
        await acquiredLock?.release();
        message.textContent = error.message || 'Could not start camera. Check permissions and retry.';
        button.disabled = false;
    } finally {
        starting = false;
    }
});

// Robust Orientation Event Listeners
window.addEventListener('deviceorientation', event => {
    if (fixedStandMode) return;
    if (event.beta !== null || event.gamma !== null || event.alpha !== null) {
        setOrientationValues(event.alpha, event.beta, event.gamma);
    }
});

window.addEventListener('deviceorientationabsolute', event => {
    if (fixedStandMode) return;
    if (event.beta !== null || event.gamma !== null || event.alpha !== null) {
        setOrientationValues(event.alpha, event.beta, event.gamma);
    }
});

// Accelerometer / Gravity vector fallback
window.addEventListener('devicemotion', event => {
    if (fixedStandMode || sensorActive) return;
    const acc = event.accelerationIncludingGravity;
    if (acc && (Number.isFinite(acc.x) || Number.isFinite(acc.y) || Number.isFinite(acc.z))) {
        const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
        const pitch = Math.atan2(-x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);
        const roll = Math.atan2(y, z) * (180 / Math.PI);
        setOrientationValues(0, pitch, roll);
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { acquireWakeLock(); heartbeat(); }
});

window.addEventListener('pagehide', () => {
    timers.forEach(clearInterval);
    socket?.disconnect();
    detector?.close();
    stream?.getTracks().forEach(track => track.stop());
    wakeLock?.release();
});
