import mammoth from '../electron/node_modules/mammoth/mammoth.browser.js';

let sessionInfo = null;
let timerInterval = null;
let startTime = Date.now();
let selectedFile = null;
let targetEndTime = null;
let serverTimeOffset = 0;
let isSubmitted = false;
let autoSubmitting = false;
let autoSubmitExam = null;
let seenWarningCount = 0;
let statusInterval = null;
let monitoringHealthy = true;
let statusPollInFlight = false;
let submissionInFlight = false;
let backendConnected = true;

let isPaperLoaded = false;
let isPaperReleased = false;

function setWorkspaceLock(locked) {
  const answerText = document.getElementById('answerText');
  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  const submitExamBtn = document.getElementById('submitExamBtn');
  let lockBanner = document.getElementById('workspaceLockedBanner');

  if (locked) {
    if (answerText) {
      answerText.disabled = true;
      answerText.placeholder = "🔒 Waiting for examiner to release question paper... Answer workspace will unlock automatically.";
      answerText.style.background = "#f8fafc";
      answerText.style.cursor = "not-allowed";
    }
    if (fileInput) fileInput.disabled = true;
    if (dropzone) {
      dropzone.style.pointerEvents = "none";
      dropzone.style.opacity = "0.5";
      dropzone.style.cursor = "not-allowed";
    }
    if (submitExamBtn) {
      submitExamBtn.disabled = true;
      submitExamBtn.style.opacity = "0.5";
      submitExamBtn.style.cursor = "not-allowed";
      submitExamBtn.title = "Answer submission is locked until the examiner releases the paper.";
    }

    if (!lockBanner) {
      const workspace = document.getElementById('answerWorkspace');
      if (workspace) {
        lockBanner = document.createElement('div');
        lockBanner.id = 'workspaceLockedBanner';
        lockBanner.style.cssText = `
          background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 8px;
          padding: 12px 16px; margin: 12px 16px 0 16px; color: #0369a1;
          font-size: 13.5px; display: flex; align-items: center; gap: 10px; font-weight: 500;
        `;
        lockBanner.innerHTML = `
          <span style="font-size: 20px;">🔒</span>
          <div>
            <strong>Answer Workspace Locked:</strong> Please stand by in the waiting lobby. Typing answers and attaching files will unlock as soon as the examiner releases the question paper.
          </div>
        `;
        workspace.prepend(lockBanner);
      }
    } else {
      lockBanner.style.display = 'flex';
    }
  } else {
    // UNLOCKED: Examiner released paper!
    if (answerText) {
      answerText.disabled = false;
      answerText.placeholder = "Type your exam answers here... Auto-saves automatically as you type.";
      answerText.style.background = "#ffffff";
      answerText.style.cursor = "text";
    }
    if (fileInput) fileInput.disabled = false;
    if (dropzone) {
      dropzone.style.pointerEvents = "auto";
      dropzone.style.opacity = "1";
      dropzone.style.cursor = "pointer";
    }
    if (submitExamBtn) {
      submitExamBtn.disabled = false;
      submitExamBtn.style.opacity = "1";
      submitExamBtn.style.cursor = "pointer";
      submitExamBtn.title = "";
    }
    if (lockBanner) {
      lockBanner.style.display = 'none';
    }
  }
}

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
    const paperUrl = `${sessionInfo.serverUrl}/exam/${encodeURIComponent(sessionInfo.examId)}/paper?sessionId=${encodeURIComponent(sessionInfo.sessionId)}`;
    const response = await fetch(paperUrl, { signal: AbortSignal.timeout(15000) });

    // HTTP 423: Paper is locked in waiting lobby by examiner
    if (response.status === 423) {
      isPaperReleased = false;
      setWorkspaceLock(true);
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
      // No paper file attached to this exam — start exam workspace and countdown immediately
      isPaperReleased = true;
      setWorkspaceLock(false);
      isPaperLoaded = true;
      if (waitingLobby) waitingLobby.style.display = 'none';
      if (paperViewer) {
        paperViewer.style.display = 'block';
        paperViewer.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 36px 24px; text-align: center; color: #475569;">
            <div style="font-size: 40px; margin-bottom: 14px;">📝</div>
            <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">No External Paper File Attached</div>
            <div style="font-size: 13.5px; color: #64748b; max-width: 360px; line-height: 1.5;">
              This exam does not require a separate PDF/Word paper. Please write your typed answer or attach your solution file in the right-hand panel.
            </div>
            <div class="badge" style="margin-top: 16px; background: #ecfdf5; color: #047857; font-weight: 600;">
              ✓ Workspace Active & Proctoring
            </div>
          </div>
        `;
      }
      if (loadingEl) loadingEl.style.display = 'none';
      if (paperStatusPill) {
        paperStatusPill.textContent = '● Workspace Active';
        paperStatusPill.style.background = '#ecfdf5';
        paperStatusPill.style.color = '#047857';
      }
      if (!targetEndTime) {
        targetEndTime = Date.now() + 60 * 60 * 1000;
      }
      startTimer();
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
    setWorkspaceLock(false);
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
          setWorkspaceLock(!isPaperReleased);
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
        autoSubmitExam?.();
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

function updateBufferStatusUI(pendingCount) {
  if (isSubmitted) return;
  const badge = document.getElementById('monitoringBadge');
  if (!badge) return;

  if (!monitoringHealthy) {
    badge.className = 'monitoring-badge offline';
    badge.textContent = 'Monitoring unavailable — notify your examiner';
    return;
  }
  if (pendingCount > 0 || !backendConnected) {
    badge.className = 'monitoring-badge offline';
    badge.innerHTML = `
      <span class="pulse-dot offline"></span>
      <span>Offline &mdash; ${pendingCount ? `${pendingCount} event${pendingCount === 1 ? '' : 's'} queued` : 'monitoring locally'}</span>
    `;
    badge.title = 'Network disconnected. Violations are safely queued in local SQLite disk buffer and will auto-sync upon reconnection.';
  } else {
    badge.className = 'monitoring-badge';
    badge.innerHTML = `
      <span class="pulse-dot"></span>
      <span>● Monitoring Active</span>
    `;
    badge.title = 'Integrity monitoring connected and streaming to backend.';
  }
}

function startSessionStatusPolling() {
  if (!sessionInfo || !sessionInfo.sessionId) return;
  if (statusInterval) clearInterval(statusInterval);

  statusInterval = setInterval(async () => {
    if (statusPollInFlight || isSubmitted) return;
    statusPollInFlight = true;
    try {
    const health = await window.api.getMonitoringHealth();
    monitoringHealthy = health.status === 'ok';
    // 1. Poll offline violation buffer state from Electron IPC
    if (window.api && typeof window.api.getBufferStatus === 'function') {
      try {
        const bufferStatus = await window.api.getBufferStatus();
        updateBufferStatusUI(bufferStatus ? bufferStatus.pendingCount : 0);
      } catch (bufErr) {}
    }

    try {
      const res = await fetch(`${sessionInfo.serverUrl}/sessions/${sessionInfo.sessionId}/status`, { signal: AbortSignal.timeout(8000) });
      backendConnected = res.ok;
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

      // Sync in-exam chat messages and announcements
      await fetchStudentMessages();
    } catch (e) {
      backendConnected = false;
      console.warn('Error polling session status:', e);
    }
    } catch (err) {
      monitoringHealthy = false;
      updateBufferStatusUI(0);
      console.warn('Monitoring health check unavailable:', err);
    } finally { statusPollInFlight = false; }
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
    noteText.innerHTML = `<strong>Examiner Note:</strong> "${escapeHtml(note)}"<br><span style="font-size:12px; margin-top:4px; display:block;">Please adjust your camera angle/lighting and capture a new verification photo.</span>`;
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

let lastPreExistingModalTime = 0;
let lastBlockedFileName = '';

function showPreExistingFileModal(data) {
  const now = Date.now();
  const fileName = data?.fileName || 'Existing Document';
  const appName = data?.appName || 'File Upload';

  // 1. Immediately disarm and clear any attached file from the upload widget so it cannot be submitted
  selectedFile = null;
  const fileInput = document.getElementById('fileInput');
  const fileCard = document.getElementById('fileCard');
  const dropzone = document.getElementById('dropzone');
  const summaryFile = document.getElementById('summaryFile');
  if (fileInput) fileInput.value = '';
  if (fileCard) fileCard.style.display = 'none';
  if (dropzone) dropzone.style.display = 'block';
  if (summaryFile) summaryFile.textContent = 'None';

  // Debounce duplicate modal triggers within 4 seconds for the same event
  if (now - lastPreExistingModalTime < 4000 && lastBlockedFileName === fileName) {
    return;
  }
  lastPreExistingModalTime = now;
  lastBlockedFileName = fileName;

  // Report violation to backend with screenshot so teacher dashboard immediately receives alert + screenshot evidence
  if (window.api && typeof window.api.sendTestViolation === 'function' && sessionInfo && sessionInfo.sessionId) {
    try {
      window.api.sendTestViolation({
        sessionId: sessionInfo.sessionId,
        type: 'unauthorized_app',
        severity: 4,
        timestamp: new Date().toISOString(),
        details: {
          reason: data?.reason || `Pre-existing file upload attempt: "${fileName}" modified before exam start.`,
          fileName: fileName,
          object_class: appName,
          action: 'file_closed_require_new'
        }
      });
    } catch (e) {
      console.warn('[ExamScreen] Error emitting pre-existing file violation to backend:', e);
    }
  }

  let modal = document.getElementById('preExistingFileBlockedModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'preExistingFileBlockedModal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.78); backdrop-filter: blur(5px);
      z-index: 9999999; display: flex; align-items: center; justify-content: center;
      padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background: #ffffff; border-radius: 14px; width: 100%; max-width: 540px; padding: 28px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35); border: 2px solid #f59e0b; text-align: left; animation: fadeInScale 0.2s ease-out;">
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
        <div style="background: #fef3c7; width: 50px; height: 50px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0;">
          🚫
        </div>
        <div>
          <h2 style="margin: 0; font-size: 19px; font-weight: 700; color: #92400e;">Pre-Existing Document Closed</h2>
          <div style="font-size: 12px; color: #b45309; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;">Exam Integrity Enforcement</div>
        </div>
      </div>

      <div style="background: #fffbeb; border: 1.5px solid #fef3c7; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
        <div style="font-size: 13.5px; color: #78350f; font-weight: 600; margin-bottom: 4px;">
          Detected File: <span style="font-family: monospace; background: #fde68a; padding: 2px 7px; border-radius: 4px; color: #451a03; font-size: 13px;">${escapeHtml(fileName)}</span>
        </div>
        <div style="font-size: 12.5px; color: #92400e; line-height: 1.5;">
          This file was created or modified prior to this exam session. Opening pre-existing files, notes, or previous assignments is strictly prohibited. <strong>The application has been automatically closed.</strong>
        </div>
      </div>

      <div style="background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-bottom: 22px;">
        <div style="font-size: 13.5px; color: #166534; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-bottom: 5px;">
          <span>📝</span> Required Action &mdash; Create a Blank File:
        </div>
        <div style="font-size: 13px; color: #15803d; line-height: 1.5;">
          You may re-open ${escapeHtml(appName)}, but you must choose <strong>"Blank document"</strong> to start a completely new file. Only work produced live during this exam is permitted.
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button id="btnAcknowledgeFileClosed" 
                style="background: #f59e0b; color: #ffffff; border: none; padding: 11px 24px; border-radius: 6px; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: background 0.15s ease; box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.3);">
          I Understand &mdash; I Will Create a New File
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const btn = document.getElementById('btnAcknowledgeFileClosed');
  if (btn) {
    btn.onclick = () => {
      modal.style.display = 'none';
      if (window.api && typeof window.api.clearClipboard === 'function') {
        window.api.clearClipboard();
      }
    };
  }
}

function handleSessionTerminated(reason) {
  window.api.finishExam().catch(console.error);
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
      Reason: <strong>"${reason || 'Terminated by examiner for integrity violation'}"</strong>
    </p>
    <div style="background:#1e293b; border:1px solid #334155; padding:12px 20px; border-radius:6px; font-size:13px; color:#94a3b8;">
      Your exam inputs have been locked by the examiner. Please contact your invigilator/teacher for further instructions.
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
  window.api.onPythonCrash(() => {
    monitoringHealthy = false;
    updateBufferStatusUI(0);
  });

  init();

  // Enforce clipboard & copy/cut/paste lockdown during exam
  ['copy', 'cut', 'paste', 'contextmenu'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
      if (window.api && window.api.clearClipboard) {
        window.api.clearClipboard();
      }
    }, true);
  });

  window.addEventListener('keydown', (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const key = e.key ? e.key.toLowerCase() : '';
    if ((isCtrlOrCmd && ['c', 'v', 'x', 'insert'].includes(key)) || (e.shiftKey && key === 'insert')) {
      e.preventDefault();
      if (window.api && window.api.clearClipboard) {
        window.api.clearClipboard();
      }
    }
  }, true);

  window.addEventListener('focus', () => {
    if (window.api && window.api.clearClipboard) {
      window.api.clearClipboard();
    }
  });

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
    if (!file) return;

    // Check if the file is pre-existing (modified prior to exam session start)
    const examStartTimeMs = (sessionInfo && sessionInfo.startTime) 
      ? new Date(sessionInfo.startTime).getTime() 
      : startTime;

    // If file was last modified more than 30 seconds before candidate joined / exam started
    if (file.lastModified && examStartTimeMs && file.lastModified < (examStartTimeMs - 30000)) {
      console.warn(`[ExamScreen] Blocked upload of pre-existing file: ${file.name} (lastModified: ${new Date(file.lastModified).toISOString()})`);
      showPreExistingFileModal({
        fileName: file.name,
        appName: 'File Upload',
        reason: `Pre-existing file blocked: "${file.name}" was modified before this exam session started (${new Date(file.lastModified).toLocaleTimeString()}).`
      });
      selectedFile = null;
      if (fileInput) fileInput.value = '';
      if (fileCard) fileCard.style.display = 'none';
      if (dropzone) dropzone.style.display = 'block';
      return;
    }

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
      // Re-validate attached file before displaying submit summary modal
      if (selectedFile) {
        const examStartTimeMs = (sessionInfo && sessionInfo.startTime) 
          ? new Date(sessionInfo.startTime).getTime() 
          : startTime;
        if (selectedFile.lastModified && examStartTimeMs && selectedFile.lastModified < (examStartTimeMs - 30000)) {
          showPreExistingFileModal({
            fileName: selectedFile.name,
            appName: 'File Upload',
            reason: `Pre-existing file blocked: "${selectedFile.name}" was modified before this exam session started.`
          });
          selectedFile = null;
          if (fileInput) fileInput.value = '';
          if (fileCard) fileCard.style.display = 'none';
          if (dropzone) dropzone.style.display = 'block';
          return;
        }
      }

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
  autoSubmitExam = handleAutoSubmit;

  async function performSubmission(isAutoSubmit = false) {
    if (!sessionInfo || isSubmitted || submissionInFlight) return;
    submissionInFlight = true;

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
        const examStartTimeMs = (sessionInfo && sessionInfo.startTime) 
          ? new Date(sessionInfo.startTime).getTime() 
          : startTime;
        if (selectedFile.lastModified && examStartTimeMs && selectedFile.lastModified < (examStartTimeMs - 30000)) {
          console.warn(`[ExamScreen] Dropped pre-existing file "${selectedFile.name}" prior to HTTP post.`);
          selectedFile = null;
        } else {
          formData.append('file', selectedFile);
        }
      }

      const submissionUrl = `${sessionInfo.serverUrl}/submissions`;
      const response = await fetch(submissionUrl, {
        signal: AbortSignal.timeout(60000),
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      // Success!
      isSubmitted = true;
      await window.api.finishExam().catch(console.error);
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
      if (isAutoSubmit) autoSubmitting = false;
      if (submitExamBtn) {
        submitExamBtn.disabled = false;
        submitExamBtn.innerHTML = `<span>Submit Exam</span><span>➔</span>`;
      }
      
      if (errorAlert) {
        errorAlertMsg.textContent = `Submission failed: ${err.message}`;
        errorAlert.style.display = 'flex';
      }
    } finally { submissionInFlight = false; }
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

  // Real-time offline buffer status events from Electron IPC
  if (window.api && typeof window.api.onBufferStatusChanged === 'function') {
    window.api.onBufferStatusChanged((status) => {
      updateBufferStatusUI(status ? status.pendingCount : 0);
    });
  }

  // Pre-existing file blocked modal listener
  if (window.api && typeof window.api.onPreExistingFileBlocked === 'function') {
    window.api.onPreExistingFileBlocked((data) => {
      console.log('[CandidateApp] Received pre-existing file blocked event:', data);
      showPreExistingFileModal(data);
    });
  }

  // Setup Student Chat Subsystem
  setupStudentChat();
});

// ==========================================
// In-Exam Chat & Examiner Inquiry System
// ==========================================
let isChatDrawerOpen = false;
let studentChatMessagesList = [];
let unreadMessageCount = 0;
let seenChatMsgIds = new Set();

function setupStudentChat() {
  const chatBtn = document.getElementById('floatingChatBtn');
  const chatDrawer = document.getElementById('studentChatDrawer');
  const closeBtn = document.getElementById('closeChatDrawerBtn');
  const chatForm = document.getElementById('studentChatForm');
  const chatInput = document.getElementById('studentChatInput');

  if (chatBtn && chatDrawer) {
    chatBtn.addEventListener('click', () => {
      isChatDrawerOpen = !isChatDrawerOpen;
      chatDrawer.style.display = isChatDrawerOpen ? 'flex' : 'none';
      if (isChatDrawerOpen) {
        unreadMessageCount = 0;
        updateChatUnreadBadge();
        const msgContainer = document.getElementById('studentChatMessages');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
        if (chatInput) chatInput.focus();
      }
    });
  }

  if (closeBtn && chatDrawer) {
    closeBtn.addEventListener('click', () => {
      isChatDrawerOpen = false;
      chatDrawer.style.display = 'none';
    });
  }

  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = '';
      await sendStudentChatMessage(text);
    });
  }
}

function updateChatUnreadBadge() {
  const badge = document.getElementById('chatUnreadBadge');
  if (!badge) return;
  if (unreadMessageCount > 0 && !isChatDrawerOpen) {
    badge.textContent = unreadMessageCount > 9 ? '9+' : unreadMessageCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function fetchStudentMessages() {
  if (!sessionInfo || !sessionInfo.sessionId || !sessionInfo.serverUrl) return;

  try {
    const examQuery = sessionInfo.examId ? `?examId=${encodeURIComponent(sessionInfo.examId)}` : '';
    const res = await fetch(`${sessionInfo.serverUrl}/messages/${sessionInfo.sessionId}${examQuery}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    const newMessages = Array.isArray(data) ? data : (data.messages || []);

    // Check for incoming new messages from teacher/broadcaster
    let newlyArrivedExaminerMsgs = 0;
    for (const msg of newMessages) {
      const mId = (msg._id || msg.id)?.toString();
      if (mId && !seenChatMsgIds.has(mId)) {
        seenChatMsgIds.add(mId);
        if (msg.sender === 'teacher' || msg.isBroadcast) {
          newlyArrivedExaminerMsgs++;
          if (!isChatDrawerOpen) {
            showExaminerChatToast(msg);
          }
        }
      }
    }

    if (!isChatDrawerOpen && newlyArrivedExaminerMsgs > 0) {
      unreadMessageCount += newlyArrivedExaminerMsgs;
      updateChatUnreadBadge();
    }

    studentChatMessagesList = newMessages;
    renderStudentMessages();
  } catch (err) {
    console.warn('Failed to sync student chat messages:', err);
  }
}

function renderStudentMessages() {
  const container = document.getElementById('studentChatMessages');
  if (!container) return;

  const welcomeHtml = `
    <div class="chat-welcome-box">
      💡 Have a clarification or typo concern on the question paper? Send a message here &mdash; your examiner will reply directly or publish an announcement.
    </div>
  `;

  if (studentChatMessagesList.length === 0) {
    container.innerHTML = welcomeHtml;
    return;
  }

  const itemsHtml = studentChatMessagesList.map(msg => {
    const isMine = msg.sender === 'candidate' || msg.sender === 'student';
    const isBroadcast = msg.isBroadcast;
    const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let bubbleClass = isMine ? 'mine' : 'theirs';
    if (isBroadcast) bubbleClass = 'theirs broadcast';

    let senderLabel = isMine ? 'You' : (isBroadcast ? '📢 EXAMINER ANNOUNCEMENT' : '👨‍🏫 Examiner');

    return `
      <div class="chat-msg ${bubbleClass}">
        <div style="font-size: 10px; font-weight: 700; margin-bottom: 2px; color: ${isBroadcast ? '#b45309' : (isMine ? '#1d4ed8' : '#475569')};">
          ${senderLabel}
        </div>
        <div class="chat-bubble">
          ${escapeHtml(msg.text)}
        </div>
        <div class="chat-msg-meta" style="${isMine ? 'text-align: right;' : ''}">
          ${timeStr}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = welcomeHtml + itemsHtml;
  container.scrollTop = container.scrollHeight;
}

async function sendStudentChatMessage(text) {
  if (!sessionInfo || !sessionInfo.sessionId || !sessionInfo.serverUrl) return;

  try {
    const payload = {
      sessionId: sessionInfo.sessionId,
      examId: sessionInfo.examId,
      sender: 'student',
      senderName: sessionInfo.studentName || sessionInfo.candidateName || 'Candidate',
      rollNumber: sessionInfo.rollNumber || sessionInfo.studentId || '',
      studentId: sessionInfo.studentId || '',
      text: text.trim()
    };

    const res = await fetch(`${sessionInfo.serverUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      const msgObj = data.message || data;
      const mId = (msgObj._id || msgObj.id)?.toString();
      if (mId && !seenChatMsgIds.has(mId)) {
        seenChatMsgIds.add(mId);
        studentChatMessagesList.push(msgObj);
        renderStudentMessages();
      } else if (!mId) {
        studentChatMessagesList.push(msgObj);
        renderStudentMessages();
      }
    }
  } catch (err) {
    console.error('Failed to send student message:', err);
  }
}

function showExaminerChatToast(msg) {
  let toast = document.getElementById('examinerChatToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'examinerChatToast';
    toast.style.cssText = `
      position: fixed; bottom: 80px; right: 24px;
      background: #0f172a; color: #ffffff; border: 1px solid #3b82f6;
      padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 25px -3px rgba(0,0,0,0.3);
      z-index: 99999; font-size: 13px; max-width: 340px;
      display: flex; flex-direction: column; gap: 6px;
      cursor: pointer; animation: slideUp 0.3s ease;
    `;
    toast.onclick = () => {
      const chatBtn = document.getElementById('floatingChatBtn');
      if (chatBtn) chatBtn.click();
      toast.style.display = 'none';
    };
    document.body.appendChild(toast);
  }

  const isBroadcast = msg.isBroadcast;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <span style="font-weight: 700; color: ${isBroadcast ? '#fbbf24' : '#60a5fa'}; font-size: 12px;">
        ${isBroadcast ? '📢 EXAM BROADCAST' : '💬 EXAMINER REPLY'}
      </span>
      <span style="font-size: 11px; color: #94a3b8;">Click to open</span>
    </div>
    <div style="color: #f1f5f9; line-height: 1.35; word-break: break-word;">
      ${escapeHtml(msg.text)}
    </div>
  `;
  toast.style.display = 'flex';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 7000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
