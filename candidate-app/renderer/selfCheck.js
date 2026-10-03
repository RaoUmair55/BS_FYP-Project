const btnCamera = document.getElementById('btn-check-camera');
const btnMic = document.getElementById('btn-check-mic');
const btnRecordVoice = document.getElementById('btn-record-voice');
const btnRecordAgainVoice = document.getElementById('btn-record-again-voice');
const btnApps = document.getElementById('btn-check-apps');
const btnUsb = document.getElementById('btn-check-usb');
const btnDisplay = document.getElementById('btn-check-display');
const btnBegin = document.getElementById('btn-begin-exam');

let cameraPassed = false;
let micPassed = false;
let voicePassed = false;
let appsPassed = false;
let usbPassed = false;
let displayPassed = false;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    let sessionInfo = null;
    try {
      sessionInfo = await window.api.getSessionInfo();
    } catch (e) {}
    if (!sessionInfo || !sessionInfo.studentName) {
      try {
        sessionInfo = JSON.parse(sessionStorage.getItem('sessionInfo') || localStorage.getItem('sessionInfo') || '{}');
      } catch (e) {}
    }
    const isLab = sessionInfo && sessionInfo.examType === 'physical_lab';
    const badge = document.getElementById('candidateInfoBadge');
    if (badge && sessionInfo) {
      const name = sessionInfo.studentName || sessionInfo.studentId || 'Candidate';
      const roll = sessionInfo.rollNumber ? ` (${sessionInfo.rollNumber})` : '';
      const exam = sessionInfo.examId ? ` • Exam: ${sessionInfo.examId}` : '';
      const labBadge = isLab ? ' • 🏫 Physical Lab Mode' : '';
      badge.textContent = `Candidate: ${name}${roll}${exam}${labBadge}`;
      if (isLab) {
        badge.style.background = '#e0f2fe';
        badge.style.color = '#0369a1';
        badge.style.border = '1px solid #7dd3fc';
      }
    }

    // If Physical Lab Exam, bypass Camera, Mic, and Voice checks automatically
    if (isLab) {
      cameraPassed = true;
      micPassed = true;
      voicePassed = true;

      ['check-camera', 'check-mic', 'check-voice'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          const icon = el.querySelector('.status-icon');
          if (icon) {
            icon.className = 'status-icon status-pass';
            icon.textContent = '✅';
          }
          const content = el.querySelector('.check-content');
          if (content) {
            content.innerHTML = '<div style="background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 8px; padding: 12px; font-size: 13px; color: #0369a1; line-height: 1.4;">🏫 <strong>Bypassed for Physical Lab Exam:</strong> Hardware cameras and microphones are not required. A human invigilator is present in the lab.</div>';
          }
        }
      });
      updateBeginButton();
    }

    // Display teacher-allowed applications if configured
    const allowedNotice = document.getElementById('allowed-apps-notice');
    if (allowedNotice && sessionInfo && sessionInfo.allowedApplications && sessionInfo.allowedApplications.length > 0) {
      const appNames = sessionInfo.allowedApplications.map(a => a.name || a.executable).join(', ');
      allowedNotice.innerHTML = `<strong>Permitted Tools for this exam:</strong> ${appNames}`;
      allowedNotice.style.display = 'block';
    }
  } catch (err) {
    console.warn('[SelfCheck] Error setting candidate badge or allowed apps:', err);
  }
});

function updateBeginButton() {
  btnBegin.disabled = !(cameraPassed && micPassed && voicePassed && appsPassed && usbPassed && displayPassed);
}

async function uploadCameraVerificationSnapshot(video) {
  try {
    let sessionInfo = null;
    try {
      sessionInfo = await window.api.getSessionInfo();
    } catch (e) {}

    if (!sessionInfo || !sessionInfo.sessionId) {
      try {
        sessionInfo = JSON.parse(sessionStorage.getItem('sessionInfo') || localStorage.getItem('sessionInfo') || '{}');
      } catch (e) {}
    }

    if (!sessionInfo || !sessionInfo.sessionId) {
      throw new Error('Candidate session missing. Return to exam entry and retry.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.85);

    const res = await fetch(`${sessionInfo.serverUrl || 'http://localhost:5000'}/sessions/${sessionInfo.sessionId}/camera-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoBase64 }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`Camera verification upload failed (${res.status})`);
    console.log('[SelfCheck] Uploaded initial camera verification photo for session:', sessionInfo.sessionId);
  } catch (err) {
    console.error('[SelfCheck] Failed to upload camera verification photo:', err);
    throw err;
  }
}

function setStatus(id, status, errorMsg = '') {
  const container = document.getElementById(id);
  const icon = container.querySelector('.status-icon');
  const errorText = container.querySelector('.error-text');

  icon.classList.remove('status-pending', 'status-pass', 'status-fail');
  if (status === 'pass') {
    icon.classList.add('status-pass');
    icon.textContent = '✅';
    errorText.style.display = 'none';
  } else if (status === 'fail') {
    icon.classList.add('status-fail');
    icon.textContent = '❌';
    errorText.textContent = errorMsg;
    errorText.style.display = 'block';
  } else {
    icon.classList.add('status-pending');
    icon.textContent = '⏳';
    errorText.style.display = 'none';
  }
}

const btnCaptureCalibration = document.getElementById('btn-capture-calibration');
let activeCameraStream = null;
let faceAlignmentInterval = null;
let isFaceProperlyAligned = false;

function startFaceAlignmentTracking(video) {
  if (faceAlignmentInterval) clearInterval(faceAlignmentInterval);

  const guideEllipse = document.getElementById('face-guide-ellipse');
  const guideText = document.getElementById('camera-guide-text');
  const btnCapture = document.getElementById('btn-capture-calibration');

  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 180;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let isChecking = false;

  faceAlignmentInterval = setInterval(async () => {
    if (!activeCameraStream || cameraPassed || !video || video.readyState < 2 || isChecking) return;
    isChecking = true;

    let faceDetected = false;
    let faceCenterX = 0.5;
    let faceCenterY = 0.5;

    try {
      ctx.drawImage(video, 0, 0, 240, 180);
      const thumbnailB64 = canvas.toDataURL('image/jpeg', 0.6);

      const data = await window.api.detectFace(thumbnailB64);
      if (data.error) throw new Error(data.error);
      if (data.detected && data.count === 1) {
        faceDetected = true;
        faceCenterX = data.faceCenterX;
        faceCenterY = data.faceCenterY;
      }
    } catch (e) {
      // If Python endpoint temporarily unreachable, try native browser detector
      if ('FaceDetector' in window) {
        try {
          const nativeDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
          const faces = await nativeDetector.detect(video);
          if (faces && faces.length > 0) {
            faceDetected = true;
            const box = faces[0].boundingBox;
            const vw = video.videoWidth || 640;
            const vh = video.videoHeight || 480;
            faceCenterX = (box.x + box.width / 2) / vw;
            faceCenterY = (box.y + box.height / 2) / vh;
          }
        } catch (err) {}
      }
    } finally {
      isChecking = false;
    }

    if (!faceDetected) {
      isFaceProperlyAligned = false;
      if (guideEllipse) {
        guideEllipse.setAttribute('stroke', '#ef4444');
        guideEllipse.setAttribute('stroke-dasharray', '8 6');
      }
      if (guideText) {
        guideText.textContent = '❌ No face detected. Look directly into camera';
        guideText.style.borderColor = '#ef4444';
        guideText.style.color = '#fecaca';
      }
      if (btnCapture) {
        btnCapture.disabled = true;
        btnCapture.style.background = '#64748b';
        btnCapture.textContent = 'Align Face in Oval to Enable';
      }
      return;
    }

    // Check if face is centered inside the oval guide (Target: 36% to 64% horizontal, 22% to 68% vertical)
    const isHorizontallyCentered = faceCenterX >= 0.36 && faceCenterX <= 0.64;
    const isVerticallyCentered = faceCenterY >= 0.22 && faceCenterY <= 0.68;
    const isCentered = isHorizontallyCentered && isVerticallyCentered;

    if (!isCentered) {
      isFaceProperlyAligned = false;
      if (guideEllipse) {
        guideEllipse.setAttribute('stroke', '#f59e0b');
        guideEllipse.setAttribute('stroke-dasharray', '8 6');
      }
      if (guideText) {
        if (!isHorizontallyCentered) {
          guideText.textContent = faceCenterX < 0.36 ? '⚠️ Move slightly left into oval' : '⚠️ Move slightly right into oval';
        } else {
          guideText.textContent = faceCenterY < 0.22 ? '⚠️ Lower your head slightly' : '⚠️ Raise your head slightly';
        }
        guideText.style.borderColor = '#f59e0b';
        guideText.style.color = '#fef08a';
      }
      if (btnCapture) {
        btnCapture.disabled = true;
        btnCapture.style.background = '#64748b';
        btnCapture.textContent = 'Center Face in Oval to Enable';
      }
    } else {
      // Face is properly centered inside the oval!
      isFaceProperlyAligned = true;
      if (guideEllipse) {
        guideEllipse.setAttribute('stroke', '#10b981');
        guideEllipse.setAttribute('stroke-dasharray', '6 4');
      }
      if (guideText) {
        guideText.textContent = '✓ Perfect! Click capture now';
        guideText.style.borderColor = '#10b981';
        guideText.style.color = '#a7f3d0';
      }
      if (btnCapture) {
        btnCapture.disabled = false;
        btnCapture.style.background = '#2563eb';
        btnCapture.textContent = '📸 2. Capture Reference Photo & Calibrate';
      }
    }
  }, 160);
}

btnCamera.addEventListener('click', async () => {
  btnCamera.disabled = true;
  btnCamera.textContent = 'Opening Camera...';

  // Cleanly release any prior active stream in the page
  if (activeCameraStream) {
    try {
      activeCameraStream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    activeCameraStream = null;
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('MediaDevices API is not supported in this browser window.');
    }

    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    console.log('[SelfCheck] Detected video devices:', videoDevices);

    let stream = null;
    let lastError = null;

    // 1. Try default ideal resolution
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
      });
    } catch (e1) {
      console.warn('[SelfCheck] Ideal constraint failed:', e1);
      lastError = e1;
    }

    // 2. Try generic video constraint
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        console.warn('[SelfCheck] Generic video constraint failed:', e2);
        lastError = e2;
      }
    }

    // 3. Try each enumerated video device individually
    if (!stream && videoDevices.length > 0) {
      for (const dev of videoDevices) {
        if (!dev.deviceId) continue;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: dev.deviceId } }
          });
          if (stream) {
            console.log(`[SelfCheck] Successfully connected to device: ${dev.label || dev.deviceId}`);
            break;
          }
        } catch (devErr) {
          console.warn(`[SelfCheck] Device ${dev.deviceId} failed:`, devErr);
          lastError = devErr;
        }
      }
    }

    if (!stream) {
      throw (lastError || new Error('No working camera stream could be initialized.'));
    }

    activeCameraStream = stream;
    const video = document.getElementById('camera-preview');
    if (video) {
      video.srcObject = stream;
      if (video.readyState >= 2) {
        startFaceAlignmentTracking(video);
      } else {
        video.onloadedmetadata = () => startFaceAlignmentTracking(video);
      }
    }

    btnCamera.style.display = 'none';
    if (btnCaptureCalibration) {
      btnCaptureCalibration.style.display = 'block';
      btnCaptureCalibration.disabled = true;
      btnCaptureCalibration.style.background = '#64748b';
      btnCaptureCalibration.textContent = 'Center Face in Oval to Enable';
    }
  } catch (err) {
    console.error('Camera Check Error:', err);
    btnCamera.disabled = false;
    btnCamera.textContent = 'Retry Camera Check';

    let userMsg = 'Camera access denied or device not found.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      userMsg = 'Camera permission denied. Please allow camera access in Windows Settings > Privacy & Security > Camera.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      userMsg = 'No camera device detected. Please connect or enable your webcam.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      userMsg = 'Camera is currently locked by another application (Zoom, Teams, Discord, or Chrome tab). Please close them and click Retry.';
    } else if (err.name === 'OverconstrainedError') {
      userMsg = 'Camera resolution constraint not supported by your webcam hardware.';
    } else {
      userMsg = `Camera error (${err.name || 'Error'}): ${err.message || 'Device unavailable'}`;
    }
    setStatus('check-camera', 'fail', userMsg);
  }
});

if (btnCaptureCalibration) {
  btnCaptureCalibration.addEventListener('click', async () => {
    const video = document.getElementById('camera-preview');
    const guideEllipse = document.getElementById('face-guide-ellipse');
    const guideText = document.getElementById('camera-guide-text');
    const successBadge = document.getElementById('calibration-success-badge');

    if (!video || !activeCameraStream) {
      alert('Camera is not active. Please turn on camera preview first.');
      return;
    }

    if (!isFaceProperlyAligned) {
      alert('Please position your face inside the green oval guide before capturing.');
      return;
    }

    if (faceAlignmentInterval) {
      clearInterval(faceAlignmentInterval);
      faceAlignmentInterval = null;
    }

    btnCaptureCalibration.disabled = true;
    btnCaptureCalibration.textContent = 'Calibrating Baseline...';

    try {
      // 1. Capture snapshot and upload for examiner verification photo
      await uploadCameraVerificationSnapshot(video);

      // 2. Save baseline reference pose metadata in storage
      const baselineData = {
        calibratedAt: new Date().toISOString(),
        videoWidth: video.videoWidth || 640,
        videoHeight: video.videoHeight || 480,
        calibratedCenter: { x: (video.videoWidth || 640) / 2, y: (video.videoHeight || 480) / 2 },
        status: 'calibrated'
      };
      localStorage.setItem('integrityflow_baseline_calibration', JSON.stringify(baselineData));
      sessionStorage.setItem('integrityflow_baseline_calibration', JSON.stringify(baselineData));

      // 3. Update UI to calibrated state
      if (guideEllipse) {
        guideEllipse.setAttribute('stroke', '#10b981');
        guideEllipse.setAttribute('stroke-width', '4');
        guideEllipse.removeAttribute('stroke-dasharray');
      }

      if (guideText) {
        guideText.textContent = '✓ Calibration Complete & Photo Saved';
        guideText.style.borderColor = '#10b981';
        guideText.style.color = '#a7f3d0';
      }

      if (successBadge) {
        successBadge.style.display = 'flex';
      }

      const instructionBox = document.getElementById('calibration-instruction-box');
      if (instructionBox) {
        instructionBox.style.display = 'block';
      }

      cameraPassed = true;
      setStatus('check-camera', 'pass');
      updateBeginButton();

      btnCaptureCalibration.textContent = '✓ Camera & Face Calibrated';
      btnCaptureCalibration.style.background = '#10b981';
    } catch (err) {
      console.error('Calibration error:', err);
      btnCaptureCalibration.disabled = false;
      btnCaptureCalibration.textContent = 'Retry Calibration';
      cameraPassed = false;
      updateBeginButton();
      setStatus('check-camera', 'fail', 'Photo was not saved. Check the server connection and retry calibration.');
    }
  });
}

btnMic.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const meter = document.getElementById('mic-level');
    let hasDetectedSound = false;

    const updateMeter = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      meter.style.width = Math.min(100, average * 2) + '%';

      if (average > 10 && !hasDetectedSound) {
        hasDetectedSound = true;
        micPassed = true;
        setStatus('check-mic', 'pass');
        updateBeginButton();
        btnMic.disabled = true;
        btnMic.textContent = 'Microphone OK';
        stream.getTracks().forEach(track => track.stop());
        microphone.disconnect();
        audioContext.close().catch(console.error);
      }

      if (!micPassed) {
          requestAnimationFrame(updateMeter);
      }
    };
    updateMeter();
  } catch (err) {
    setStatus('check-mic', 'fail', 'Microphone access denied or not found.');
  }
});

function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * numChannels * bits/8)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16 bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

async function recordVoiceSample(durationSeconds = 8) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const microphoneLabel = stream.getAudioTracks()[0].label;
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const sampleRate = audioContext.sampleRate;
  const source = audioContext.createMediaStreamSource(stream);
  const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

  const recordedChunks = [];
  scriptNode.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    recordedChunks.push(new Float32Array(inputData));
  };

  source.connect(scriptNode);
  scriptNode.connect(audioContext.destination);

  const statusBox = document.getElementById('voice-recording-status');
  if (statusBox) {
    statusBox.innerHTML = 'Read the verification phrase aloud: <span id="voice-countdown"></span>';
    statusBox.style.display = 'block';
  }
  const countdownEl = document.getElementById('voice-countdown');

  try {
    for (let s = durationSeconds; s > 0; s--) {
      if (countdownEl) countdownEl.textContent = `${s}s`;
      await new Promise(res => setTimeout(res, 1000));
    }
    if (countdownEl) countdownEl.textContent = 'Processing...';
  } finally {
    source.disconnect();
    scriptNode.disconnect();
    stream.getTracks().forEach(t => t.stop());
    await audioContext.close();
  }

  let totalLength = 0;
  for (const chunk of recordedChunks) totalLength += chunk.length;
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of recordedChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const targetSr = 16000;
  let resampled;
  if (sampleRate === targetSr) {
    resampled = merged;
  } else {
    const targetLength = Math.round(merged.length * targetSr / sampleRate);
    resampled = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const srcIndex = (i * sampleRate) / targetSr;
      const indexFloor = Math.floor(srcIndex);
      const frac = srcIndex - indexFloor;
      const s0 = merged[indexFloor] || 0;
      const s1 = merged[indexFloor + 1] || s0;
      resampled[i] = s0 + frac * (s1 - s0);
    }
  }

  const wavBuffer = encodeWAV(resampled, targetSr);
  const base64Wav = arrayBufferToBase64(wavBuffer);
  return { audio: 'data:audio/wav;base64,' + base64Wav, microphoneLabel };
}

async function handleVoiceRecord() {
  const statusBox = document.getElementById('voice-recording-status');
  if (btnRecordVoice) {
    btnRecordVoice.disabled = true;
    btnRecordVoice.textContent = 'Recording in progress...';
  }
  if (btnRecordAgainVoice) {
    btnRecordAgainVoice.style.display = 'none';
  }
  voicePassed = false;
  updateBeginButton();
  setStatus('check-voice', 'pending');

  try {
    const sample = await recordVoiceSample(8);
    if (statusBox) statusBox.textContent = 'Confirmation: repeat the phrase naturally after the countdown.';
    await new Promise(resolve => setTimeout(resolve, 2000));
    const confirmation = await recordVoiceSample(4);
    if (sample.microphoneLabel !== confirmation.microphoneLabel) throw new Error('Microphone changed between recordings.');
    if (statusBox) statusBox.textContent = 'Calibrating speaker embedding profile...';

    const result = await window.api.setReferenceVoice({ ...sample, confirmation: confirmation.audio });
    if (result && result.success) {
      voicePassed = true;
      setStatus('check-voice', 'pass');
      if (btnRecordVoice) {
        btnRecordVoice.textContent = '✓ Voice Profile Calibrated';
        btnRecordVoice.style.background = '#10b981';
        btnRecordVoice.style.color = '#ffffff';
        btnRecordVoice.disabled = true;
      }
      if (btnRecordAgainVoice) {
        btnRecordAgainVoice.style.display = 'block';
      }
      if (statusBox) {
        statusBox.textContent = '✓ Speaker identity profile successfully calibrated (256-d vector saved).';
        statusBox.style.color = '#10b981';
      }
    } else {
      voicePassed = false;
      setStatus('check-voice', 'fail', result?.error || 'Could not verify sufficient speech duration. Please speak louder and retry.');
      if (btnRecordVoice) {
        btnRecordVoice.disabled = false;
        btnRecordVoice.textContent = 'Retry Voice Recording';
      }
      if (statusBox) statusBox.style.display = 'none';
    }
    updateBeginButton();
  } catch (err) {
    console.error('Voice Recording Error:', err);
    voicePassed = false;
    setStatus('check-voice', 'fail', 'Microphone access failed or recording error.');
    if (btnRecordVoice) {
      btnRecordVoice.disabled = false;
      btnRecordVoice.textContent = 'Retry Voice Recording';
    }
    if (statusBox) statusBox.style.display = 'none';
    updateBeginButton();
  }
}

if (btnRecordVoice) {
  btnRecordVoice.addEventListener('click', handleVoiceRecord);
}

if (btnRecordAgainVoice) {
  btnRecordAgainVoice.addEventListener('click', () => {
    if (btnRecordVoice) {
      btnRecordVoice.disabled = false;
      btnRecordVoice.textContent = '🎙️ Record Voice Sample (4s)';
      btnRecordVoice.style.background = '#f1f5f9';
      btnRecordVoice.style.color = '#334155';
    }
    btnRecordAgainVoice.style.display = 'none';
    voicePassed = false;
    setStatus('check-voice', 'pending');
    updateBeginButton();
    handleVoiceRecord();
  });
}


btnApps.addEventListener('click', async () => {
  try {
    setStatus('check-apps', 'pending');
    btnApps.textContent = 'Checking...';
    btnApps.disabled = true;

    const result = await window.api.checkApps();
    if (result.error) throw new Error(result.error);
    const apps = result.unauthorized_apps || [];

    const list = document.getElementById('unauthorized-list');
    list.innerHTML = '';

    if (apps.length === 0) {
      appsPassed = true;
      const successMsg = document.createElement('li');
      successMsg.textContent = 'All clear — no unauthorized applications detected.';
      successMsg.style.color = '#10b981';
      list.appendChild(successMsg);
      setStatus('check-apps', 'pass');
      btnApps.textContent = 'Apps OK';
      // Disable the button on success so they can proceed
      btnApps.disabled = true;
    } else {
      appsPassed = false;
      const explanation = document.createElement('li');
      explanation.textContent = "This looks like a running application we don't recognize as part of the exam setup — please close it before continuing.";
      explanation.style.color = '#374151';
      explanation.style.marginBottom = '0.5rem';
      list.appendChild(explanation);

      apps.forEach(app => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.marginBottom = '8px';
        li.style.padding = '8px';
        li.style.background = '#f9fafb';
        li.style.border = '1px solid #e5e7eb';
        li.style.borderRadius = '4px';

        const text = document.createElement('span');
        text.textContent = app.display;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.padding = '4px 12px';
        closeBtn.style.fontSize = '12px';
        closeBtn.style.backgroundColor = '#ef4444';

        closeBtn.onclick = async () => {
           closeBtn.disabled = true;
           closeBtn.textContent = 'Closing...';
           const result = await window.api.killApp(app.name);
           if (result.success) {
               btnApps.click(); // Automatically re-check
           } else {
               closeBtn.textContent = 'Failed';
               closeBtn.style.backgroundColor = '#6b7280';
           }
        };

        li.appendChild(text);
        li.appendChild(closeBtn);
        list.appendChild(li);
      });
      setStatus('check-apps', 'fail', 'Unauthorized apps found.');
      btnApps.textContent = 'Recheck';
      btnApps.disabled = false;
    }
    updateBeginButton();
  } catch (err) {
    setStatus('check-apps', 'fail', 'Failed to check running apps.');
    btnApps.disabled = false;
    btnApps.textContent = 'Recheck';
  }
});

btnUsb.addEventListener('click', async () => {
  try {
    setStatus('check-usb', 'pending');
    btnUsb.textContent = 'Scanning USB Drives...';
    btnUsb.disabled = true;

    const result = await window.api.checkUsbDrives();
    if (result.error) throw new Error(result.error);
    const drives = result.removable_drives || [];

    const list = document.getElementById('usb-list');
    list.innerHTML = '';

    if (drives.length === 0) {
      usbPassed = true;
      const successMsg = document.createElement('li');
      successMsg.textContent = 'All clear — no removable USB storage devices detected.';
      successMsg.style.color = '#10b981';
      list.appendChild(successMsg);
      setStatus('check-usb', 'pass');
      btnUsb.textContent = 'USB Storage OK';
      btnUsb.disabled = true;
    } else {
      usbPassed = false;
      const explanation = document.createElement('li');
      explanation.textContent = "Removable flash drive(s) or external hard drive(s) detected — please unplug all removable storage to continue:";
      explanation.style.color = '#374151';
      explanation.style.marginBottom = '0.5rem';
      list.appendChild(explanation);

      drives.forEach(drive => {
        const li = document.createElement('li');
        li.style.marginBottom = '6px';
        li.style.padding = '8px';
        li.style.background = '#fef2f2';
        li.style.border = '1px solid #fee2e2';
        li.style.borderRadius = '4px';
        li.style.color = '#991b1b';
        li.style.fontSize = '13px';
        li.textContent = `💾 Drive ${drive.device || drive.mountpoint} — ${drive.label || 'Removable Storage'} (${drive.fstype || 'FAT32'})`;
        list.appendChild(li);
      });

      setStatus('check-usb', 'fail', 'Please remove all USB drives / external storage.');
      btnUsb.textContent = 'Recheck USB Drives';
      btnUsb.disabled = false;
    }
    updateBeginButton();
  } catch (err) {
    console.error('USB Check Error:', err);
    setStatus('check-usb', 'fail', 'Failed to scan USB storage.');
    btnUsb.disabled = false;
    btnUsb.textContent = 'Recheck USB Drives';
  }
});

btnDisplay.addEventListener('click', async () => {
  try {
    setStatus('check-display', 'pending');
    btnDisplay.textContent = 'Checking Displays...';
    btnDisplay.disabled = true;

    const result = await window.api.getDisplayCount();
    const count = result.count || 1;

    if (count === 1) {
      displayPassed = true;
      setStatus('check-display', 'pass');
      btnDisplay.textContent = 'Single Display OK';
      btnDisplay.disabled = true;
    } else {
      displayPassed = false;
      setStatus('check-display', 'fail', `Multiple displays detected (${count} monitors active). Please disconnect additional displays — only 1 display is permitted during the exam.`);
      btnDisplay.textContent = 'Recheck Displays';
      btnDisplay.disabled = false;
    }
    updateBeginButton();
  } catch (err) {
    console.error('Display Check Error:', err);
    setStatus('check-display', 'fail', 'Failed to verify display setup.');
    btnDisplay.disabled = false;
    btnDisplay.textContent = 'Recheck Displays';
  }
});

btnBegin.addEventListener('click', async () => {
    btnBegin.disabled = true;
    btnBegin.textContent = 'Starting Exam Mode...';
    try {
        if (activeCameraStream) {
            activeCameraStream.getTracks().forEach(track => track.stop());
            activeCameraStream = null;
        }
        const result = await window.api.startExamMode();
        if (!result.success) {
            alert('Failed to start exam mode: ' + result.error);
            btnBegin.disabled = false;
            btnBegin.textContent = 'Begin Exam';
        }
    } catch (err) {
        alert('Error starting exam mode.');
        btnBegin.disabled = false;
        btnBegin.textContent = 'Begin Exam';
    }
});
