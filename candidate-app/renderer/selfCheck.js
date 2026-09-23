const btnCamera = document.getElementById('btn-check-camera');
const btnMic = document.getElementById('btn-check-mic');
const btnApps = document.getElementById('btn-check-apps');
const btnUsb = document.getElementById('btn-check-usb');
const btnDisplay = document.getElementById('btn-check-display');
const btnBegin = document.getElementById('btn-begin-exam');

let cameraPassed = false;
let micPassed = false;
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
    const badge = document.getElementById('candidateInfoBadge');
    if (badge && sessionInfo) {
      const name = sessionInfo.studentName || sessionInfo.studentId || 'Candidate';
      const roll = sessionInfo.rollNumber ? ` (${sessionInfo.rollNumber})` : '';
      const exam = sessionInfo.examId ? ` • Exam: ${sessionInfo.examId}` : '';
      badge.textContent = `Candidate: ${name}${roll}${exam}`;
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
  btnBegin.disabled = !(cameraPassed && micPassed && appsPassed && usbPassed && displayPassed);
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
      console.warn('[SelfCheck] Cannot upload camera verification photo: missing sessionId');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const photoBase64 = canvas.toDataURL('image/jpeg', 0.85);

    const res = await fetch(`http://localhost:5000/sessions/${sessionInfo.sessionId}/camera-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoBase64 })
    });
    console.log('[SelfCheck] Uploaded initial camera verification photo for session:', sessionInfo.sessionId, 'Status:', res.status);
  } catch (err) {
    console.error('[SelfCheck] Failed to upload camera verification photo:', err);
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

      const resp = await fetch('http://127.0.0.1:8000/detect-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: thumbnailB64 }),
        signal: AbortSignal.timeout(1000)
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.detected) {
          faceDetected = true;
          faceCenterX = data.faceCenterX;
          faceCenterY = data.faceCenterY;
        }
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
          guideText.textContent = faceCenterX < 0.36 ? '⚠️ Move slightly right into oval' : '⚠️ Move slightly left into oval';
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
  try {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (firstErr) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
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
    setStatus('check-camera', 'fail', 'Camera access denied or device not found.');
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
      setStatus('check-camera', 'fail', 'Failed to save baseline calibration.');
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
      }
      
      if (!micPassed || hasDetectedSound) {
          requestAnimationFrame(updateMeter);
      }
    };
    updateMeter();
  } catch (err) {
    setStatus('check-mic', 'fail', 'Microphone access denied or not found.');
  }
});

btnApps.addEventListener('click', async () => {
  try {
    setStatus('check-apps', 'pending');
    btnApps.textContent = 'Checking...';
    btnApps.disabled = true;

    const result = await window.api.checkApps();
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
