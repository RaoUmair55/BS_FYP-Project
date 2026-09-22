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

let activeCameraStream = null;

btnCamera.addEventListener('click', async () => {
  try {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (firstErr) {
      // Fallback with ideal resolution constraints if default video: true fails
      stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 } } 
      });
    }
    
    activeCameraStream = stream;
    const video = document.getElementById('camera-preview');
    if (video) {
      video.srcObject = stream;
    }
    
    // Check if video metadata is ready
    const handleMetadata = () => {
        cameraPassed = true;
        setStatus('check-camera', 'pass');
        updateBeginButton();
        btnCamera.disabled = true;
        btnCamera.textContent = 'Camera OK';

        // Capture snapshot for teacher camera verification
        if (video) {
          uploadCameraVerificationSnapshot(video);
        }
    };

    if (video) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        handleMetadata();
      } else {
        video.onloadedmetadata = handleMetadata;
      }
    } else {
      handleMetadata();
    }
  } catch (err) {
    console.error('Camera Check Error:', err);
    setStatus('check-camera', 'fail', 'Camera access denied or not found.');
  }
});

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
