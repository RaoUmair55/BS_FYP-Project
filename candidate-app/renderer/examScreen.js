import mammoth from '../electron/node_modules/mammoth/mammoth.browser.js';

let sessionInfo = null;
let timerInterval = null;
let startTime = Date.now();
let selectedFile = null;
let targetEndTime = null;
let serverTimeOffset = 0;
let isSubmitted = false;
let autoSubmitting = false;
let seenWarningCount = 0;
let statusInterval = null;

let isPaperLoaded = false;
let isPaperReleased = false;

function renderWatermark() {
  const overlay = document.getElementById('watermarkOverlay');
  if (!overlay || !sessionInfo) return;
  
  const name = sessionInfo.studentName || sessionInfo.studentId || 'Candidate';
  const roll = sessionInfo.rollNumber || sessionInfo.studentId || 'N/A';
  const exam = sessionInfo.examId || 'EXAM';
  const text = `CONFIDENTIAL • ${name} (${roll}) • ${exam} • IntegrityFlow`;
  
  overlay.innerHTML = '';
  // Generate repeating diagonal watermark rows covering entire panel
  for (let i = 0; i < 14; i++) {
    const row = document.createElement('div');
    row.className = 'watermark-row';
    row.textContent = `${text}       ${text}       ${text}       ${text}`;
    overlay.appendChild(row);
  }
  overlay.style.display = 'flex';
}

async function loadExamPaper() {
  const loadingEl = document.getElementById('loadingMessage');
  const paperViewer = document.getElementById('paperViewer');
  const waitingLobby = document.getElementById('waitingLobby');
  const paperStatusPill = document.getElementById('paperStatusPill');

  if (!sessionInfo || isPaperLoaded) return;

  try {
    const paperUrl = `${sessionInfo.serverUrl}/exam/${sessionInfo.examId}/paper`;
    const response = await fetch(paperUrl);

    // HTTP 423: Paper is locked in waiting lobby by examiner
    if (response.status === 423) {
      isPaperReleased = false;
      if (waitingLobby) waitingLobby.style.display = 'flex';
      if (loadingEl) loadingEl.style.display = 'none';
      if (paperViewer) paperViewer.style.display = 'none';
      if (paperStatusPill) {
        paperStatusPill.textContent = '🔒 Waiting Lobby';
        paperStatusPill.style.background = '#e0f2fe';
        paperStatusPill.style.color = '#0369a1';
      }
      const timerDisplay = document.getElementById('timerDisplay');
      if (timerDisplay) {
        timerDisplay.textContent = 'Standby (Lobby)';
        timerDisplay.className = 'timer-badge';
      }
      return;
    }

    if (response.status === 404) {
      if (loadingEl) {
        loadingEl.style.display = 'block';
        loadingEl.innerHTML = `<div class="info-message">Exam paper not yet available &mdash; please wait for your examiner.</div>`;
      }
      return;
    }

    if (response.status === 403) {
      if (loadingEl) {
        loadingEl.style.display = 'block';
        loadingEl.innerHTML = `<div class="error-message">Session not active. Please ensure you have officially started the exam.</div>`;
      }
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Paper is unlocked & available!
    isPaperReleased = true;
    isPaperLoaded = true;
    if (waitingLobby) waitingLobby.style.display = 'none';
    if (paperViewer) paperViewer.style.display = 'block';
    if (paperStatusPill) {
      paperStatusPill.textContent = '✓ Paper Active';
      paperStatusPill.style.background = '#ecfdf5';
      paperStatusPill.style.color = '#047857';
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();

    if (loadingEl) loadingEl.style.display = 'none';

    if (contentType.includes('pdf')) {
      await renderPdf(arrayBuffer, paperViewer);
    } else if (contentType.includes('wordprocessingml') || contentType.includes('msword')) {
      await renderDocx(arrayBuffer, paperViewer);
    } else {
      try {
        await renderPdf(arrayBuffer, paperViewer);
      } catch (e) {
        if (loadingEl) {
          loadingEl.style.display = 'block';
          loadingEl.innerHTML = `<div class="error-message">Unsupported file format uploaded.</div>`;
        }
      }
    }

    // Render dynamic anti-leak watermark with candidate's details
    renderWatermark();

    // Start synchronized countdown timer
    startTimer();

  } catch (error) {
    console.error('Error fetching/rendering paper:', error);
    if (loadingEl) {
      loadingEl.style.display = 'block';
      loadingEl.innerHTML = `<div class="error-message">Failed to load exam paper: ${error.message}</div>`;
    }
  }
}

async function init() {
  try {
    sessionInfo = await window.api.getSessionInfo();
    if (!sessionInfo || !sessionInfo.examId) {
      throw new Error("Missing session information.");
    }
    
    // Update Header Elements
    const studentBadge = document.getElementById('studentBadge');
    const examBadge = document.getElementById('examBadge');
    if (studentBadge) {
      const name = sessionInfo.studentName || sessionInfo.studentId || 'Candidate';
      const roll = sessionInfo.rollNumber ? ` (${sessionInfo.rollNumber})` : '';
      studentBadge.textContent = `Student: ${name}${roll}`;
    }
    if (examBadge) examBadge.textContent = `Exam: ${sessionInfo.examId}`;

    // Fetch initial session timing, lobby status, and warnings
    try {
      const statusRes = await fetch(`${sessionInfo.serverUrl}/sessions/${sessionInfo.sessionId}/status`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.endTime) {
          targetEndTime = new Date(statusData.endTime).getTime();
        }
        if (statusData.serverTime) {
          serverTimeOffset = new Date(statusData.serverTime).getTime() - Date.now();
        }
        const durationBadge = document.getElementById('durationBadge');
        if (durationBadge && statusData.totalDurationMinutes) {
          durationBadge.textContent = `Total: ${statusData.totalDurationMinutes}m`;
        }
        if (statusData.paperReleased !== undefined) {
          isPaperReleased = statusData.paperReleased;
        }
      }
    } catch (e) {
      console.warn("Initial status fetch error:", e);
    }

    // Default targetEndTime fallback only if paper is already released and timed
    if (isPaperReleased && !targetEndTime) {
      targetEndTime = Date.now() + 60 * 60 * 1000;
    }

    // Start status polling
    startSessionStatusPolling();

    // Restore draft answer from LocalStorage if present
    restoreDraft();

    // Load question paper (or show waiting lobby if locked)
    await loadExamPaper();

  } catch (error) {
    console.error('Initialization error:', error);
    const loadingEl = document.getElementById('loadingMessage');
    if (loadingEl) {
      loadingEl.style.display = 'block';
      loadingEl.innerHTML = `<div class="error-message">Initialization failed: ${error.message}</div>`;
    }
  }
}

function startTimer() {
  const timerDisplay = document.getElementById('timerDisplay');
  if (!timerDisplay) return;

  if (timerInterval) clearInterval(timerInterval);
  
  if (!isPaperReleased || !targetEndTime) {
    timerDisplay.textContent = 'Standby (Lobby)';
    timerDisplay.className = 'timer-badge';
    return;
  }
  
  const updateCountdown = () => {
    if (isSubmitted) return;
    const now = Date.now() + serverTimeOffset;
    const remainingMs = (targetEndTime || (now + 60 * 60 * 1000)) - now;

    if (remainingMs <= 0) {
      timerDisplay.textContent = `Time Left: 00:00`;
      timerDisplay.className = 'timer-badge critical';
      if (!isSubmitted && !autoSubmitting) {
        autoSubmitting = true;
        handleAutoSubmit();
      }
      return;
    }

    const totalSecs = Math.floor(remainingMs / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    let timeStr = '';
    if (hrs > 0) {
      timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
      timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    timerDisplay.textContent = `Time Left: ${timeStr}`;

    // Update alert styling states
    if (totalSecs <= 60) {
      timerDisplay.className = 'timer-badge critical';
    } else if (totalSecs <= 300) {
      timerDisplay.className = 'timer-badge urgent';
    } else {
      timerDisplay.className = 'timer-badge';
    }
  };

  updateCountdown();
  timerInterval = setInterval(updateCountdown, 1000);
}

function startSessionStatusPolling() {
  if (!sessionInfo || !sessionInfo.sessionId) return;
  if (statusInterval) clearInterval(statusInterval);

  statusInterval = setInterval(async () => {
    try {
      const res = await fetch(`${sessionInfo.serverUrl}/sessions/${sessionInfo.sessionId}/status`);
      if (!res.ok) return;
      const data = await res.json();

      // Check if session has been terminated by examiner
      if (data.status === 'terminated') {
        handleSessionTerminated(data.terminationReason);
        return;
      }

      // Check if question paper was released by examiner to exit waiting lobby
      if (data.paperReleased === true && !isPaperLoaded) {
        if (data.endTime) {
          targetEndTime = new Date(data.endTime).getTime();
        }
        await loadExamPaper();
      }

      // Check for global or session time extension from examiner
      if (data.endTime) {
        const newEndMs = new Date(data.endTime).getTime();
        if (targetEndTime && newEndMs > targetEndTime + 10000) {
          const addedMinutes = Math.round((newEndMs - targetEndTime) / (60 * 1000));
          targetEndTime = newEndMs;
          showExaminerTimeExtensionToast(addedMinutes);
        } else {
          targetEndTime = newEndMs;
        }
      }

      if (data.serverTime) {
        serverTimeOffset = new Date(data.serverTime).getTime() - Date.now();
      }

      const durationBadge = document.getElementById('durationBadge');
      if (durationBadge && data.totalDurationMinutes) {
        durationBadge.textContent = `Total: ${data.totalDurationMinutes}m`;
      }

      // Check for new warnings sent by examiner
      if (data.warnings && data.warnings.length > seenWarningCount) {
        const newWarnings = data.warnings.slice(seenWarningCount);
        seenWarningCount = data.warnings.length;
        const latestWarning = newWarnings[newWarnings.length - 1];
        showExaminerWarningToast(latestWarning.message);
      }

      // Check if examiner flagged camera verification (issue with initial photo)
      if ((data.cameraVerificationStatus === 'rejected' || data.cameraVerificationStatus === 'flagged' || data.cameraVerificationStatus === 're_verify') && !isReverifyingCamera) {
        showCameraReverificationModal(data.cameraVerificationNote);
      }
    } catch (e) {
      console.warn('Error polling session status:', e);
    }
  }, 3000);
}

let isReverifyingCamera = false;
let reverifyStream = null;

async function showCameraReverificationModal(note) {
  const modal = document.getElementById('reverifyCameraModal');
  const video = document.getElementById('reverify-video');
  const noteText = document.getElementById('reverifyNoteText');
  const snapBtn = document.getElementById('btn-snap-reverification');

  if (!modal || isReverifyingCamera) return;
  isReverifyingCamera = true;

  if (noteText && note) {
    noteText.innerHTML = `<strong>Examiner Note:</strong> "${note}"<br><span style="font-size:12px; margin-top:4px; display:block;">Please adjust your camera angle/lighting and capture a new verification photo.</span>`;
  }

  modal.style.display = 'flex';

  try {
    reverifyStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    if (video) video.srcObject = reverifyStream;
  } catch (err) {
    console.error('Failed to open reverification camera:', err);
  }

  if (snapBtn) {
    snapBtn.onclick = async () => {
      if (!video) return;
      snapBtn.disabled = true;
      snapBtn.textContent = 'Submitting New Photo...';

      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const photoBase64 = canvas.toDataURL('image/jpeg', 0.85);

        const res = await fetch(`${sessionInfo.serverUrl}/sessions/${sessionInfo.sessionId}/camera-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoBase64 })
        });

        if (reverifyStream) {
          reverifyStream.getTracks().forEach(t => t.stop());
          reverifyStream = null;
        }

        modal.style.display = 'none';
        isReverifyingCamera = false;
        showPhotoSubmittedToast();
      } catch (e) {
        console.error('Failed to upload reverified photo:', e);
        snapBtn.disabled = false;
        snapBtn.textContent = 'Retry Capture';
      }
    };
  }
}

function showPhotoSubmittedToast() {
  let toast = document.getElementById('photoSubmittedToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'photoSubmittedToast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #ecfdf5; color: #065f46; border: 2px solid #10b981;
      padding: 12px 20px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      z-index: 999999; font-weight: 600; font-size: 14px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `✓ Verification photo updated & sent to examiner.`;
  toast.style.display = 'flex';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 5000);
}

function showExaminerTimeExtensionToast(addedMinutes) {
  let toast = document.getElementById('timeExtensionToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'timeExtensionToast';
    toast.style.cssText = `
      position: fixed; top: 75px; left: 50%; transform: translateX(-50%);
      background: #ecfdf5; color: #065f46; border: 2px solid #10b981;
      padding: 14px 20px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      z-index: 999999; font-weight: 600; font-size: 14px; max-width: 90%;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      animation: fadeInDown 0.4s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <div>🎉 <strong>TIME EXTENDED!</strong> Your examiner added <strong>+${addedMinutes} minutes</strong> to this exam.</div>
    <button onclick="document.getElementById('timeExtensionToast').style.display='none'" 
            style="background:#10b981; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;">
      Got it
    </button>
  `;
  toast.style.display = 'flex';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 8000);
}

function showExaminerWarningToast(msg) {
  let toast = document.getElementById('examinerWarningToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'examinerWarningToast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #fef3c7; color: #92400e; border: 2px solid #f59e0b;
      padding: 14px 20px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      z-index: 999999; font-weight: 600; font-size: 14px; max-width: 90%;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <div>⚠️ EXAMINER WARNING: ${msg}</div>
    <button onclick="document.getElementById('examinerWarningToast').style.display='none'" 
            style="background:#f59e0b; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:bold;">
      Acknowledge
    </button>
  `;
  toast.style.display = 'flex';
}

function handleSessionTerminated(reason) {
  if (statusInterval) clearInterval(statusInterval);
  if (timerInterval) clearInterval(timerInterval);

  let termOverlay = document.getElementById('sessionTerminatedOverlay');
  if (!termOverlay) {
    termOverlay = document.createElement('div');
    termOverlay.id = 'sessionTerminatedOverlay';
    termOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.96); backdrop-filter: blur(8px);
      z-index: 1000000; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center; color: white; padding: 24px;
    `;
    document.body.appendChild(termOverlay);
  }
  termOverlay.innerHTML = `
    <div style="background:#ef4444; width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:16px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
    </div>
    <h1 style="font-size:24px; font-weight:700; margin-bottom:8px; color:#f87171;">SESSION TERMINATED BY EXAMINER</h1>
    <p style="font-size:15px; color:#cbd5e1; max-width:480px; margin-bottom:24px; line-height:1.5;">
      Reason: <strong>"${reason || 'Integrity Policy Violation'}"</strong>
    </p>
    <div style="background:#1e293b; border:1px solid #334155; padding:12px 20px; border-radius:6px; font-size:13px; color:#94a3b8;">
      Your exam inputs have been locked. Please contact your invigilator/teacher for further instructions.
    </div>
  `;
}

function restoreDraft() {
  const answerText = document.getElementById('answerText');
  const saveStatus = document.getElementById('saveStatus');
  if (!answerText || !sessionInfo) return;

  const draftKey = `integrityflow_draft_${sessionInfo.sessionId}`;
  const saved = localStorage.getItem(draftKey);
  if (saved) {
    answerText.value = saved;
    updateWordCount();
    if (saveStatus) saveStatus.textContent = "Restored local draft";
  }
}

function saveDraft() {
  const answerText = document.getElementById('answerText');
  const saveStatus = document.getElementById('saveStatus');
  if (!answerText || !sessionInfo) return;

  const draftKey = `integrityflow_draft_${sessionInfo.sessionId}`;
  localStorage.setItem(draftKey, answerText.value);
  
  const now = new Date().toLocaleTimeString();
  if (saveStatus) saveStatus.textContent = `Auto-saved at ${now}`;
  updateWordCount();
}

function updateWordCount() {
  const answerText = document.getElementById('answerText');
  const wordCountEl = document.getElementById('wordCount');
  if (!answerText || !wordCountEl) return;

  const text = answerText.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  wordCountEl.textContent = `Word count: ${words} words`;
  return words;
}

async function renderPdf(buffer, container) {
  const blob = new Blob([buffer], { type: 'application/pdf' });
  const blobUrl = URL.createObjectURL(blob);
  container.innerHTML = `<iframe src="${blobUrl}" style="width:100%; height:100%; border:none;" title="Exam Paper PDF"></iframe>`;
}

async function renderDocx(buffer, container) {
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  container.innerHTML = `<div class="docx-container">${result.value}</div>`;
}

// Setup Event Listeners
window.addEventListener('DOMContentLoaded', () => {
  init();

  // Tab Switching
  const tabTextBtn = document.getElementById('tabTextBtn');
  const tabFileBtn = document.getElementById('tabFileBtn');
  const tabTextContent = document.getElementById('tabTextContent');
  const tabFileContent = document.getElementById('tabFileContent');

  if (tabTextBtn && tabFileBtn) {
    tabTextBtn.addEventListener('click', () => {
      tabTextBtn.classList.add('active');
      tabFileBtn.classList.remove('active');
      tabTextContent.classList.add('active');
      tabFileContent.classList.remove('active');
    });

    tabFileBtn.addEventListener('click', () => {
      tabFileBtn.classList.add('active');
      tabTextBtn.classList.remove('active');
      tabFileContent.classList.add('active');
      tabTextContent.classList.remove('active');
    });
  }

  // Auto-save on typing
  const answerText = document.getElementById('answerText');
  if (answerText) {
    answerText.addEventListener('input', () => {
      saveDraft();
    });
  }

  // File Upload Handling
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileCard = document.getElementById('fileCard');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const removeFileBtn = document.getElementById('removeFileBtn');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#2563eb';
    });
    
    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = '#cbd5e1';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#cbd5e1';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
      }
    });

    if (removeFileBtn) {
      removeFileBtn.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        fileCard.style.display = 'none';
        dropzone.style.display = 'block';
      });
    }
  }

  function handleFileSelect(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    const kb = (file.size / 1024).toFixed(1);
    fileSize.textContent = `${kb} KB`;
    fileCard.style.display = 'flex';
    dropzone.style.display = 'none';
  }

  // Submission Dialog & Flow
  const submitExamBtn = document.getElementById('submitExamBtn');
  const confirmModal = document.getElementById('confirmModal');
  const cancelSubmitBtn = document.getElementById('cancelSubmitBtn');
  const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
  const errorAlert = document.getElementById('errorAlert');
  const errorAlertMsg = document.getElementById('errorAlertMsg');
  const retryBtn = document.getElementById('retryBtn');

  if (submitExamBtn) {
    submitExamBtn.addEventListener('click', () => {
      const typed = answerText ? answerText.value.trim() : '';
      if (!typed && !selectedFile) {
        alert("Please enter a typed answer or attach an answer file before submitting.");
        return;
      }

      // Populate Modal Summary
      const words = typed ? typed.split(/\s+/).length : 0;
      document.getElementById('summaryWords').textContent = `${words} words`;
      document.getElementById('summaryFile').textContent = selectedFile ? selectedFile.name : 'None';

      confirmModal.style.display = 'flex';
    });
  }

  if (cancelSubmitBtn) {
    cancelSubmitBtn.addEventListener('click', () => {
      confirmModal.style.display = 'none';
    });
  }

  if (confirmSubmitBtn) {
    confirmSubmitBtn.addEventListener('click', async () => {
      confirmModal.style.display = 'none';
      await performSubmission();
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      errorAlert.style.display = 'none';
      await performSubmission();
    });
  }

  async function handleAutoSubmit() {
    const autoModal = document.getElementById('autoSubmitModal');
    if (autoModal) autoModal.style.display = 'flex';
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.style.display = 'none';
    await performSubmission(true);
  }

  async function performSubmission(isAutoSubmit = false) {
    if (!sessionInfo || isSubmitted) return;

    if (errorAlert) errorAlert.style.display = 'none';
    if (submitExamBtn) {
      submitExamBtn.disabled = true;
      submitExamBtn.innerHTML = `<span>${isAutoSubmit ? 'Auto-Submitting...' : 'Submitting...'}</span>`;
    }

    try {
      const formData = new FormData();
      formData.append('sessionId', sessionInfo.sessionId);
      if (isAutoSubmit) {
        formData.append('autoSubmitted', 'true');
      }
      if (answerText && answerText.value.trim()) {
        formData.append('answerText', answerText.value.trim());
      }
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      const submissionUrl = `${sessionInfo.serverUrl}/submissions`;
      const response = await fetch(submissionUrl, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      // Success!
      isSubmitted = true;
      if (timerInterval) clearInterval(timerInterval);
      if (statusInterval) clearInterval(statusInterval);
      localStorage.removeItem(`integrityflow_draft_${sessionInfo.sessionId}`);

      const autoModal = document.getElementById('autoSubmitModal');
      if (autoModal) autoModal.style.display = 'none';

      document.getElementById('answerWorkspace').style.display = 'none';
      document.getElementById('successScreen').style.display = 'flex';
      
      const badge = document.getElementById('monitoringBadge');
      if (badge) {
        badge.style.background = '#f1f5f9';
        badge.style.color = '#475569';
        badge.style.borderColor = '#cbd5e1';
        badge.innerHTML = `<span>✓ Exam Submitted</span>`;
      }
    } catch (err) {
      console.error('Submission failed:', err);
      if (submitExamBtn) {
        submitExamBtn.disabled = false;
        submitExamBtn.innerHTML = `<span>Submit Exam</span><span>➔</span>`;
      }
      
      if (errorAlert) {
        errorAlertMsg.textContent = `Submission failed: ${err.message}`;
        errorAlert.style.display = 'flex';
      }
    }
  }

  // Test violation button handler
  const testBtn = document.getElementById('testViolationBtn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const info = await window.api.getSessionInfo();
      const payload = {
        sessionId: info ? info.sessionId : "unknown",
        type: "second_person_detected",
        severity: 4,
        timestamp: new Date().toISOString(),
        details: { confidence: 0.95, duration: 3000 }
      };
      window.api.sendTestViolation(payload);
      testBtn.textContent = 'Sent!';
      setTimeout(() => { testBtn.textContent = 'Test Alert'; }, 1500);
    });
  }
});
