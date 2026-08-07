const btnCamera = document.getElementById('btn-check-camera');
const btnMic = document.getElementById('btn-check-mic');
const btnApps = document.getElementById('btn-check-apps');
const btnBegin = document.getElementById('btn-begin-exam');

let cameraPassed = false;
let micPassed = false;
let appsPassed = false;

function updateBeginButton() {
  btnBegin.disabled = !(cameraPassed && micPassed && appsPassed);
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

btnCamera.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.getElementById('camera-preview');
    video.srcObject = stream;
    
    // Check if video is blank (placeholder for MediaPipe)
    video.onloadedmetadata = () => {
        // Just checking resolution or letting it play is enough for now
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            cameraPassed = true;
            setStatus('check-camera', 'pass');
            updateBeginButton();
            btnCamera.disabled = true;
            btnCamera.textContent = 'Camera OK';
        } else {
            setStatus('check-camera', 'fail', 'Camera feed appears blank.');
        }
    };
  } catch (err) {
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
        li.textContent = `Please close: ${app}`;
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

btnBegin.addEventListener('click', async () => {
    btnBegin.disabled = true;
    btnBegin.textContent = 'Starting Exam Mode...';
    try {
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
