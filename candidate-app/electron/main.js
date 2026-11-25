/*
 * IntegrityFlow file overview
 * Purpose: Main controller of the Electron candidate application.
 * How it works: Creates the window and controls login, consent, identity, self-check and exam 
 * navigation. Starts and stops Python, discovers its port, handles renderer IPC requests, 
 * and applies exam window, clipboard and display restrictions.
 * Connection: Connects preload.js, the renderer screens and ipc helpers; 
 * it owns the active session and monitoring lifecycle.
 */
let displayCheckInterval = null;
let devVoiceEnabled = false;
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, clipboard, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID, randomBytes } = require('crypto');
const { StringDecoder } = require('string_decoder');
const { spawn, execSync } = require('child_process');
const { startReceiver, stopReceiver } = require('./ipc/violationForwarder');
const { checkPythonHealth, setPythonPort, getPythonUrl, getLastPythonHealthError, forwardViolationToServer, killApp, startBufferRetryLoop, stopBufferRetryLoop, setExamActive, getExamActive, setSessionToken, setLocalIpcSecret, getLocalIpcHeaders } = require('./ipc/pythonBridge');
const { isAllowedRendererUrl, isAllowedPermission, shouldBlockShortcut, verifySessionEndedOnServer } = require('./ipc/windowSecurity');
const violationBuffer = require('./ipc/violationBuffer');
const { getPythonExecutable } = require('./ipc/pythonRuntime');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RENDERER_DIR = path.resolve(__dirname, '..', 'renderer');
const isDevMode = () => (process.env.APP_MODE || '').trim().toLowerCase() === 'dev';
const LOCAL_IPC_SECRET = randomBytes(32).toString('hex');
setLocalIpcSecret(LOCAL_IPC_SECRET);
let isAppQuitting = false;
let pythonCrashRestarts = 0;
const MAX_PYTHON_CRASH_RESTARTS = 2;

// --- Added for development: Handle EPIPE / Broken pipe errors ---
// This prevents the Electron app from crashing if the parent process (like Antigravity IDE)
// closes and standard output/error pipes are broken before this process exits.
process.on('uncaughtException', /* Function purpose: Handles the uncaughtException event and updates the associated screen or process state. */ function (err) {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE: broken pipe on stdout/stderr
    return;
  }
  console.error('Unhandled Exception:', err);
});
// ----------------------------------------------------------------
let mainWindow;
let pythonProcess = null;
let receiverPort = null;
let displayAddedListener = null;
let displayRemovedListener = null;
let activeSessionInfo = {
  sessionId: null,
  examId: null,
  examType: 'online',
  studentId: null,
  studentName: null,
  rollNumber: null,
  consentGiven: false,
  consentTimestamp: null,
  allowedApplications: [],
  rules: {},
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000'
};

// Function purpose: Stops Python monitoring and clears its process state during shutdown.
function cleanUpPythonProcess() {
  if (pythonProcess) {
    console.log('[Electron] Cleaning up existing Python process...');
    pythonProcess.killedIntentional = true;
    const pid = pythonProcess.pid;
    if (process.platform === 'win32' && pid && !pythonProcess.hasExited) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) { }
    } else {
      try { pythonProcess.kill('SIGTERM'); } catch (e) { }
    }
    pythonProcess = null;
  }
  setPythonPort(null);
}

// Function purpose: Creates the Electron window and loads the candidate login screen.
async function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  const devMode = isDevMode();
  if (!devMode) {
    Menu.setApplicationMenu(null);
  }

  mainWindow = new BrowserWindow({
    title: 'IntegrityFlow',
    icon: iconPath,
    width: 1024,
    height: 768,
    autoHideMenuBar: !devMode,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: devMode,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (!devMode) {
    mainWindow.setMenuBarVisibility(false);
  }

  // Block popup windows and navigations outside the local IntegrityFlow renderer pages
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedRendererUrl(navigationUrl, RENDERER_DIR)) {
      console.warn('[Electron] Blocked unauthorized navigation to:', navigationUrl);
      event.preventDefault();
    }
  });

  // Block DevTools, Reload, Print, Save, and exam-exit shortcuts in production/exam builds
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (shouldBlockShortcut(input, { isDevMode: isDevMode(), examActive: getExamActive() })) {
      event.preventDefault();
    }
  });

  // Prevent closing the window mid-exam without submitting first
  mainWindow.on('close', (event) => {
    if (getExamActive() && !isDevMode() && !isAppQuitting) {
      event.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Exam In Progress',
        message: 'You cannot close IntegrityFlow while an exam is active.',
        detail: 'Please submit your exam first. Once submitted, you may safely close the application.',
        buttons: ['Return to Exam']
      }).catch(() => {});
    }
  });

  mainWindow.webContents.on('render-process-gone', /* Function purpose: Handles the render-process-gone event and updates the associated screen or process state. */ (event, details) => {
    console.error('[Electron] Renderer process crashed/gone:', details);
  });

  mainWindow.webContents.on('did-fail-load', /* Function purpose: Handles the did-fail-load event and updates the associated screen or process state. */ (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] did-fail-load:', errorCode, errorDescription, validatedURL);
  });

  const targetUrl = path.join(__dirname, '../renderer/login.html');
  console.log('[Electron] Loading file:', targetUrl);
  await mainWindow.loadFile(targetUrl);
}

// Function purpose: Polls the Python health endpoint until startup succeeds or the wait expires.
async function waitForPythonReady(proc) {
  console.log('[Electron] Waiting for Python backend to be ready...');
  const maxAttempts = 200;
  const deadline = Date.now() + 120000; // Cold-start ML imports have a bounded two-minute budget.

  for (let i = 0; i < maxAttempts && Date.now() < deadline; i++) {
    if (!proc || proc.hasExited) {
      console.error(`[Electron] Aborting health check: Python process exited prematurely with code ${proc?.exitCode}.`);
      return false;
    }
    const isReady = await checkPythonHealth(proc.instanceId);
    if (isReady) {
      console.log(`[Electron] Python backend is ready on attempt ${i + 1}!`);
      return true;
    }
    await new Promise(/* Function purpose: Runs setTimeout as part of this callback’s processing. */ resolve => setTimeout(resolve, 600)); // Poll every 600ms
  }

  return false;
}

let lastPythonStderr = '';

// Function purpose: Starts the Python backend with the session configuration and local communication ports.
function spawnPythonProcess(mode, isSelfCheck = false) {
  cleanUpPythonProcess();

  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  let pythonExe;
  try {
    if (!fs.existsSync(pythonScript)) throw new Error(`AI entry point missing: ${pythonScript}`);
    pythonExe = getPythonExecutable();
  } catch (err) {
    lastPythonStderr = err.message;
    return null;
  }
  const instanceId = randomUUID();
  console.log(`[Electron] Spawning Python process in ${mode} mode (isSelfCheck=${isSelfCheck}): ${pythonExe} ${pythonScript}`);

  lastPythonStderr = '';

  // Inject session ID and allowed applications to the Python environment
  const pythonEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHON_IPC_PORT: '0',
    AI_INSTANCE_ID: instanceId,
    INTEGRITYFLOW_IPC_SECRET: LOCAL_IPC_SECRET,
    ELECTRON_RECEIVER_PORT: String(receiverPort),
    AI_SPOOL_DIR: path.join(app.getPath('userData'), 'python-alerts'),
    EXAM_SESSION_ID: activeSessionInfo.sessionId,
    EXAM_TYPE: activeSessionInfo.examType || 'online',
    APP_MODE: mode,
    // Audio/voice monitoring disabled for now (opt-in via ENABLE_VOICE_MONITORING=true)
    VOICE_MONITORING_ENABLED: (process.env.ENABLE_VOICE_MONITORING || '').trim().toLowerCase() === 'true' && devVoiceEnabled ? 'true' : 'false',
    IS_SELF_CHECK: isSelfCheck ? 'true' : 'false',
    ALLOWED_APPLICATIONS: JSON.stringify(activeSessionInfo.allowedApplications || []),
    EXAM_RULES: JSON.stringify(activeSessionInfo.rules || {})
  };

  let proc;
  try {
    proc = spawn(pythonExe, [pythonScript], {
      env: pythonEnv,
      cwd: path.dirname(pythonScript),
      windowsHide: true
    });
    proc.instanceId = instanceId;
    proc.hasExited = false;
    proc.exitCode = null;
  } catch (err) {
    lastPythonStderr = err.message;
    console.error(`[Electron] Failed to spawn ${pythonExe}:`, err);
    return null;
  }

  proc.on('error', /* Function purpose: Handles the error event and updates the associated screen or process state. */ (err) => {
    proc.hasExited = true;
    lastPythonStderr = `${err.message}. Interpreter: ${pythonExe}. Check PYTHON_PATH and the local virtual environment.`;
    console.error(`[Electron] Python spawn process error:`, err);
  });

  const decoder = new StringDecoder('utf8');
  let pendingOutput = '';
  proc.stdout.on('data', /* Function purpose: Handles the data event and updates the associated screen or process state. */ (data) => {
    pendingOutput += decoder.write(data);
    const lines = pendingOutput.split(/\r?\n/);
    pendingOutput = lines.pop();
    for (const line of lines) {
      const match = /^INTEGRITYFLOW_PORT=(\d+)$/.exec(line.trim());
      if (match && !proc.killedIntentional) setPythonPort(Number(match[1]));
      else if (line.trim()) console.log(`[Python] ${line}`);
    }
  });

  proc.stderr.on('data', /* Function purpose: Handles the data event and updates the associated screen or process state. */ (data) => {
    const msg = data.toString().trim();
    if (!proc.killedIntentional) lastPythonStderr = (lastPythonStderr + '\n' + msg).trim().slice(-8192);
    console.log(`[Python Log] ${msg}`);
  });

  proc.on('exit', /* Function purpose: Handles unexpected Python sidecar exits by alerting the examiner and attempting bounded recovery. */ (code, signal) => {
    proc.hasExited = true;
    proc.exitCode = code;
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (proc.killedIntentional) return;

    const examRunning = getExamActive();
    if (examRunning && activeSessionInfo.sessionId) {
      forwardViolationToServer({
        sessionId: activeSessionInfo.sessionId,
        type: 'camera_issue',
        severity: 4,
        timestamp: new Date().toISOString(),
        details: {
          reason: `Proctoring AI sidecar exited unexpectedly during active exam (code=${code}, signal=${signal || 'none'}).`
        }
      }, true).catch(err => console.error('[Electron] Failed to report Python crash violation:', err));

      if (pythonCrashRestarts < MAX_PYTHON_CRASH_RESTARTS) {
        pythonCrashRestarts += 1;
        console.warn(`[Electron] Attempting automatic Python sidecar recovery (${pythonCrashRestarts}/${MAX_PYTHON_CRASH_RESTARTS})...`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('python-crashed', { code, signal, restarting: true, attempt: pythonCrashRestarts });
        }
        setTimeout(async () => {
          if (!getExamActive() || isAppQuitting) return;
          const targetMode = isDevMode() ? 'dev' : 'exam';
          pythonProcess = spawnPythonProcess(targetMode, false);
          const ready = pythonProcess ? await waitForPythonReady(pythonProcess) : false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-crashed', {
              code, signal, recovered: ready, restarting: false, error: ready ? null : lastPythonStderr
            });
          }
        }, 2000);
        return;
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-crashed', { code, signal, restarting: false, recovered: false, error: lastPythonStderr });
    }
  });

  return proc;
}

process.on('unhandledRejection', /* Function purpose: Handles the unhandledRejection event and updates the associated screen or process state. */ (reason, promise) => {
  console.error('[Electron] Unhandled Rejection:', reason);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Electron] Another instance is already running. Quitting duplicate instance...');
  app.quit();
} else {
  app.on('second-instance', /* Function purpose: Handles the second-instance event and updates the associated screen or process state. */ () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(/* Function purpose: Runs console.log as part of this callback’s processing. */ async () => {
    try {
      console.log('[Electron] app.whenReady entered');

      // Grant only explicitly whitelisted hardware/notification permissions to local renderer pages; deny everything else
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const requestingUrl = webContents?.getURL?.() || '';
        callback(isAllowedPermission(permission, requestingUrl, RENDERER_DIR));
      });

      session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const requestingUrl = webContents?.getURL?.() || '';
        return isAllowedPermission(permission, requestingUrl, RENDERER_DIR);
      });

      cleanUpPythonProcess();
      try {
        receiverPort = await startReceiver(/* Function purpose: Runs if as part of this callback’s processing. */ (violationPayload) => {
          if (violationPayload?.sessionId !== activeSessionInfo.sessionId) return;
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            const reason = violationPayload?.details?.reason || '';
            const fileName = violationPayload?.details?.fileName || '';
            if (fileName || reason.toLowerCase().includes('pre-existing')) {
              console.log('[Electron] Pre-existing file blocked! Sending alert to candidate window:', fileName);
              mainWindow.webContents.send('pre-existing-file-blocked', {
                fileName: fileName || (reason.includes(':') ? reason.split(':').pop().trim() : 'Document'),
                reason: reason,
                appName: violationPayload?.details?.object_class || 'winword.exe',
                action: violationPayload?.details?.action,
                alreadyReported: true
              });
            }
          }
        }, LOCAL_IPC_SECRET);
      } catch (error) {
        console.error('[Electron] Failed to start receiver:', error);
        dialog.showErrorBox('Initialization Error', 'Failed to start local violation receiver. ' + error.message);
        app.quit();
        return;
      }

      console.log('[Electron] Calling createWindow()...');
      // STARTUP ORDER 2: Create the BrowserWindow directly (Python spawns after login)
      await createWindow();
      console.log('[Electron] createWindow() completed.');

      // STARTUP ORDER 3: Start disk buffer background retry loop for offline resilience
      startBufferRetryLoop(12000, /* Function purpose: Runs if as part of this callback’s processing. */ (status) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('buffer-status-changed', status);
        }
      });
      console.log('[Electron] startBufferRetryLoop() initialized.');

      app.on('activate', /* Function purpose: Handles the activate event and updates the associated screen or process state. */ () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (err) {
      console.error('[Electron] Fatal error during startup:', err);
      dialog.showErrorBox('Candidate app startup failed', err.message);
      app.quit();
    }
  });
}

app.on('window-all-closed', /* Function purpose: Handles the window-all-closed event and updates the associated screen or process state. */ () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function cleanupDisplayMonitoring() {
  if (displayAddedListener) {
    screen.removeListener('display-added', displayAddedListener);
    displayAddedListener = null;
  }
  if (displayRemovedListener) {
    screen.removeListener('display-removed', displayRemovedListener);
    displayRemovedListener = null;
  }
  if (displayCheckInterval) {
    clearInterval(displayCheckInterval);
    displayCheckInterval = null;
  }
}

app.on('before-quit', /* Function purpose: Handles the before-quit event and updates the associated screen or process state. */ () => {
  isAppQuitting = true;
  console.log('[Electron] Cleaning up processes before quit...');
  setExamActive(false);
  stopBufferRetryLoop();
  cleanUpPythonProcess();
  cleanupDisplayMonitoring();
  stopReceiver();
});

process.on('exit', /* Function purpose: Handles the exit event and updates the associated screen or process state. */ () => {
  cleanUpPythonProcess();
});
process.on('SIGINT', /* Function purpose: Handles the SIGINT event and updates the associated screen or process state. */ () => {
  cleanUpPythonProcess();
  process.exit(0);
});
process.on('SIGTERM', /* Function purpose: Handles the SIGTERM event and updates the associated screen or process state. */ () => {
  cleanUpPythonProcess();
  process.exit(0);
});

// Returns current count of pending offline buffered violations
ipcMain.handle('get-buffer-status', /* Function purpose: Returns pending offline-alert counts to the candidate screen. */ () => {
  return violationBuffer.getBufferStatus();
});

// Listen for test/pre-existing-file violations from renderer
ipcMain.on('test-violation', /* Function purpose: Forwards authorized renderer alerts (dev test alerts or pre-existing file upload blocks). */ async (event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const isPreExistingFileBlock = payload.type === 'unauthorized_app' && payload.details?.action === 'file_closed_require_new';
  if (!isDevMode() && !isPreExistingFileBlock) {
    console.warn('[Electron] Ignored renderer test-violation outside dev mode:', payload.type);
    return;
  }
  const safePayload = {
    sessionId: activeSessionInfo.sessionId || payload.sessionId,
    type: payload.type,
    severity: payload.severity,
    timestamp: payload.timestamp || new Date().toISOString(),
    details: payload.details
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const image = await mainWindow.webContents.capturePage();
      const screenshotsDir = path.join(__dirname, '..', 'ai-module', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
      const screenshotFile = path.join(screenshotsDir, `shot_${safePayload.sessionId || 'session'}_${Date.now()}.jpg`);
      fs.writeFileSync(screenshotFile, image.toJPEG(80));
      safePayload.screenshotPath = screenshotFile;
    } catch (e) {
      console.warn('[Electron] Could not capture renderer page screenshot:', e);
    }
  }
  await forwardViolationToServer(safePayload);
});

// Check apps via Python
ipcMain.handle('check-apps', /* Function purpose: Asks Python which running applications violate the exam whitelist. */ async () => {
  try {
    const response = await fetch(`${getPythonUrl()}/check-apps`, {
      headers: getLocalIpcHeaders(),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return { error: 'App check unavailable' };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-apps:', error);
    return { error: 'App check unavailable' };
  }
});

// Check USB removable storage drives via Python
ipcMain.handle('check-usb-drives', /* Function purpose: Asks Python for removable drives during the candidate self-check. */ async () => {
  try {
    const response = await fetch(`${getPythonUrl()}/check-usb`, {
      headers: getLocalIpcHeaders(),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return { error: 'USB check unavailable' };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-usb:', error);
    return { error: 'USB check unavailable' };
  }
});

// Function purpose: Counts connected physical displays asynchronously so Electron's main thread never stalls.
async function getPhysicalMonitorCount() {
  const electronDisplays = screen.getAllDisplays();
  let count = electronDisplays.length;

  if (process.platform === 'win32') {
    try {
      const { execFile } = require('child_process');
      const stdout = await new Promise((resolve, reject) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', '@(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue | Where-Object { $_.Active -eq $true }).Count'],
          { timeout: 4000, windowsHide: true },
          (err, out) => (err ? reject(err) : resolve(out))
        );
      });
      const wmiCount = parseInt(String(stdout).trim(), 10);
      if (!isNaN(wmiCount) && wmiCount > 0) {
        count = Math.max(count, wmiCount);
      }
    } catch (e) { }
  }
  return count;
}

// Get display count and information via Electron screen module & WMI hardware query
ipcMain.handle('get-display-count', /* Function purpose: Counts physical monitors and reports whether the single-display requirement is met. */ async () => {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const totalCount = await getPhysicalMonitorCount();
  return {
    count: totalCount,
    displays: displays.map(/* Function purpose: Transforms each entry into the value needed by this operation. */ d => ({
      id: d.id,
      bounds: d.bounds,
      isPrimary: d.id === primaryDisplay.id
    }))
  };
});

// Kill App
ipcMain.handle('kill-app', /* Function purpose: Asks the enforcement backend to close the named application. */ async (event, name) => {
  return await killApp(name);
});

// Set Reference Voice profile via Python
ipcMain.handle('set-reference-voice', /* Function purpose: Sends the recorded enrollment audio to Python for speaker-reference validation. */ async (event, audioBase64) => {
  try {
    const response = await fetch(`${getPythonUrl()}/set-reference-voice`, {
      method: 'POST',
      headers: getLocalIpcHeaders({ 'Content-Type': 'application/json' }),
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        audio_base64: typeof audioBase64 === "string" ? audioBase64 : audioBase64.audio,
        confirmation_audio: audioBase64.confirmation,
        microphone_label: audioBase64.microphoneLabel,
        session_id: activeSessionInfo.sessionId
      })
    });
    if (!response.ok) return { success: false, error: 'HTTP error ' + response.status };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error calling /set-reference-voice:', error);
    return { success: false, error: error.message };
  }
});

// Check Voice profile calibration status
ipcMain.handle('check-voice', /* Function purpose: Checks whether voice enrollment and monitoring are ready. */ async () => {
  try {
    const response = await fetch(`${getPythonUrl()}/check-voice`, {
      headers: getLocalIpcHeaders(),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { calibrated: false };
    return await response.json();
  } catch (error) {
    return { calibrated: false };
  }
});

ipcMain.handle('detect-face', /* Function purpose: Sends a self-check camera image to Python for face-position guidance. */ async (_event, image) => {
  const response = await fetch(`${getPythonUrl()}/detect-face`, {
    method: 'POST', headers: getLocalIpcHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ image }), signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error('Face alignment service unavailable.');
  return response.json();
});

ipcMain.handle('capture-identity-photo', /* Function purpose: Retrieves a recent camera frame without opening another webcam stream. */ async () => {
  if (!activeSessionInfo || activeSessionInfo.examType === 'physical_lab') return { success: false, error: 'Camera checks are unavailable for this session' };
  try {
    const response = await fetch(`${getPythonUrl()}/identity-photo`, {
      headers: getLocalIpcHeaders(),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error('Camera service unavailable');
    return await response.json();
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('monitoring-health', /* Function purpose: Retrieves the Python monitoring health for the candidate connection indicator. */ async () => {
  try {
    const response = await fetch(`${getPythonUrl()}/health`, {
      headers: getLocalIpcHeaders(),
      signal: AbortSignal.timeout(3000)
    });
    return await response.json();
  } catch (err) { return { status: 'unavailable', errors: [err.message] }; }
});

ipcMain.handle('finish-exam', /* Function purpose: Verifies server-confirmed completion/termination before shutting down exam monitoring. */ async () => {
  if (getExamActive() && !isDevMode()) {
    const check = await verifySessionEndedOnServer({
      serverUrl: activeSessionInfo.serverUrl,
      sessionId: activeSessionInfo.sessionId,
      sessionToken: activeSessionInfo.sessionToken
    });
    if (!check.allowed) {
      console.warn('[Electron] Blocked unverified finish-exam request:', check.reason);
      return { success: false, error: check.reason };
    }
  }
  setExamActive(false);
  cleanupDisplayMonitoring();
  cleanUpPythonProcess();
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
  }
  return { success: true };
});

// Return session info to renderer
ipcMain.handle('get-session-info', /* Function purpose: Returns the active candidate session configuration to the renderer. */ () => {
  return { ...activeSessionInfo, isDevMode: (process.env.APP_MODE || '').trim().toLowerCase() === 'dev' };
});

let isLoggingIn = false;

// Handle Login / Exam Code Entry
ipcMain.handle('login', /* Function purpose: Stores validated candidate entry data and begins the exam-specific setup flow. */ async (event, { examId, studentId, studentName, rollNumber, allowedApplications, examType, rules, requireSecondaryCamera }) => {
  if (isLoggingIn) {
    console.log('[Electron] Login already in progress, ignoring duplicate invoke');
    return { success: false, error: 'Login in progress' };
  }
  isLoggingIn = true;
  devVoiceEnabled = false;
  try {

    console.log(`[Electron] Candidate entering exam. Exam: ${examId}, Type: ${examType}, Allowed Apps:`, allowedApplications);
    setExamActive(false);
    setSessionToken(null, null);
    activeSessionInfo.sessionId = null;
    activeSessionInfo.sessionToken = null;
    activeSessionInfo.consentGiven = false;
    activeSessionInfo.consentTimestamp = null;
    activeSessionInfo.examId = examId;
    if (examType) activeSessionInfo.examType = examType;
    activeSessionInfo.rules = rules || {};
    activeSessionInfo.requireSecondaryCamera = requireSecondaryCamera === true;
    if (studentId) activeSessionInfo.studentId = studentId;
    if (studentName) activeSessionInfo.studentName = studentName;
    if (rollNumber) activeSessionInfo.rollNumber = rollNumber;
    if (allowedApplications && Array.isArray(allowedApplications)) {
      activeSessionInfo.allowedApplications = allowedApplications;
    }

    // Clean up any previously running Python child process before spawning a new one
    cleanUpPythonProcess();

    // 1. Show splash/loading screen immediately while Python spawns and health-checks
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
    }

    // 2. Spawn python in configured mode (exam/dev) for self-check
    const targetMode = (process.env.APP_MODE || '').trim().toLowerCase() === 'dev' ? 'dev' : 'exam';
    pythonProcess = spawnPythonProcess(targetMode, true);

    const isPythonReady = await waitForPythonReady(pythonProcess);
    if (!isPythonReady) {
      isLoggingIn = false;
      const startupError = (pythonProcess?.hasExited ? lastPythonStderr : getLastPythonHealthError()) || lastPythonStderr;
      cleanUpPythonProcess();
      const errorDetail = startupError
        ? `The AI module failed to start.\n\nDiagnostics / Error:\n${startupError}`
        : 'The AI module failed to start.\n\nPlease verify that Python is in your system PATH and all dependencies are installed.';
      dialog.showErrorBox('Initialization Error', errorDetail);
      if (mainWindow) {
        await mainWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
      }
      return { success: false, error: 'AI module failed to start' };
    }

    // 3. Python is ready -> proceed to consent screen
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/consent.html'));
    }
    isLoggingIn = false;
    return { success: true };
  } catch (err) {
    cleanUpPythonProcess();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
    return { success: false, error: err.message };
  } finally { isLoggingIn = false; }
});

// Handle Transition from Consent Screen to Identity Screen
ipcMain.handle('proceed-to-identity', /* Function purpose: Requires explicit consent before opening the identity-entry screen. */ async (event, consentData) => {
  if (consentData?.consentGiven !== true) throw new Error('Please review and accept the monitoring notice before continuing.');
  console.log('[Electron] Consent granted. Proceeding to Identity Capture...');
  if (consentData) {
    activeSessionInfo.consentGiven = true;
    activeSessionInfo.consentTimestamp = consentData.consentTimestamp || new Date();
  }
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/identity.html'));
  }
  return { success: true };
});

// Handle Transition from Identity Screen to Self-Check
ipcMain.handle('proceed-to-self-check', /* Function purpose: Stores identity information and opens the pre-exam self-check screen. */ async (event, identityData) => {
  console.log('[Electron] Identity captured. Proceeding to Self-Check...');
  if (identityData) {
    activeSessionInfo.sessionId = identityData.sessionId;
    activeSessionInfo.sessionToken = identityData.sessionToken;
    setSessionToken(identityData.sessionId, identityData.sessionToken);
    activeSessionInfo.requireSecondaryCamera = identityData.requireSecondaryCamera === true;
    activeSessionInfo.studentName = identityData.studentName;
    activeSessionInfo.rollNumber = identityData.rollNumber;
    activeSessionInfo.studentId = identityData.studentId || identityData.rollNumber;
    if (identityData.examId) activeSessionInfo.examId = identityData.examId;
  }
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/selfCheck.html'));
  }
  return { success: true };
});

// Handle Decline from Consent Screen
ipcMain.handle('decline-consent', /* Function purpose: Stops setup and returns to login when the candidate declines monitoring consent. */ async () => {
  console.log('[Electron] Candidate declined monitoring consent. Gracefully quitting...');
  cleanUpPythonProcess();
  stopReceiver();
  app.quit();
  return { success: true };
});

// Start Exam Mode
let isStartingExam = false;
ipcMain.handle('start-exam-mode', /* Function purpose: Starts exam monitoring and applies window, display and clipboard restrictions. */ async (event, options = {}) => {
  if (isStartingExam) return { success: false, error: 'Exam startup is already in progress.' };
  isStartingExam = true;
  devVoiceEnabled = (process.env.ENABLE_VOICE_MONITORING || '').trim().toLowerCase() === 'true' ? options?.voiceEnabled !== false : false;
  setExamActive(false);
  try {
    if (activeSessionInfo.requireSecondaryCamera) {
      const response = await fetch(`${activeSessionInfo.serverUrl}/pairing/start`, {
        method: 'POST', headers: { Authorization: `Bearer ${activeSessionInfo.sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionInfo.sessionId, prepare: true }), signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Side camera must be verified');
    }
    console.log('[Electron] Transitioning to Exam Mode...');
    cleanUpPythonProcess();

    // Clean up any previous display listeners and intervals before re-registering
    cleanupDisplayMonitoring();

    // Register display addition listener for continuous monitoring during active exam
    displayAddedListener = /* Function purpose: Handles interaction with displayAddedListener. */ async (event, newDisplay) => {
      if (!getExamActive()) return;
      const totalDisplays = screen.getAllDisplays().length;
      console.log(`[Electron] Display change detected during exam! Total displays: ${totalDisplays}, New display ID: ${newDisplay?.id}`);

      const violationPayload = {
        sessionId: activeSessionInfo.sessionId,
        type: 'multiple_displays_detected',
        severity: 4,
        timestamp: new Date().toISOString(),
        details: {
          object_class: 'secondary_display',
          displayId: newDisplay?.id,
          totalDisplays: totalDisplays
        }
      };

      // Direct call to backend via forwardViolationToServer (originates in Electron)
      await forwardViolationToServer(violationPayload);
    };
    screen.on('display-added', displayAddedListener);

    displayRemovedListener = /* Function purpose: Handles interaction with displayRemovedListener. */ (event, oldDisplay) => {
      console.log(`[Electron] Display removed during exam. Total displays remaining: ${screen.getAllDisplays().length}`);
    };
    screen.on('display-removed', displayRemovedListener);

    if (displayCheckInterval) {
      clearInterval(displayCheckInterval);
      displayCheckInterval = null;
    }
    // Function purpose: Safety-net WMI display check every 20s (display-added event fires instantly at 0ms).
    let displayScanInFlight = false;
    displayCheckInterval = setInterval(async () => {
      if (displayScanInFlight || !getExamActive()) return;
      displayScanInFlight = true;
      try {
      const currentCount = await getPhysicalMonitorCount();
      if (currentCount > 1) {
        console.log(`[Electron] Multiple physical displays detected during exam via WMI scan! Total: ${currentCount}`);
        const violationPayload = {
          sessionId: activeSessionInfo.sessionId,
          type: 'multiple_displays_detected',
          severity: 4,
          timestamp: new Date().toISOString(),
          details: {
            object_class: 'secondary_display',
            totalDisplays: currentCount,
            detectionMethod: 'wmi_hardware_scan'
          }
        };
        await forwardViolationToServer(violationPayload);
      }
      } catch (error) {
        console.error('[Electron] Periodic display check failed:', error);
      } finally {
        displayScanInFlight = false;
      }
    }, 20000);

    // Small delay to ensure port is freed
    const targetMode = (process.env.APP_MODE || '').trim().toLowerCase() === 'dev' ? 'dev' : 'exam';
    pythonProcess = spawnPythonProcess(targetMode, false);
    const isReady = await waitForPythonReady(pythonProcess);

    if (isReady) {
      if (mainWindow) {
        clipboard.clear();
        if (activeSessionInfo.requireSecondaryCamera) {
          const response = await fetch(`${activeSessionInfo.serverUrl}/pairing/start`, {
            method: 'POST', headers: { Authorization: `Bearer ${activeSessionInfo.sessionToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: activeSessionInfo.sessionId }), signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) throw new Error((await response.json()).error || 'Side camera connection must be restored');
        }
        await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
        // Officially activate live proctoring & violation capture now that examScreen is active
        pythonCrashRestarts = 0;
        setExamActive(true);
        if (!isDevMode() && mainWindow && !mainWindow.isDestroyed()) {
          if ((activeSessionInfo.allowedApplications || []).length === 0) {
            mainWindow.setFullScreen(true);
          } else {
            mainWindow.maximize();
          }
        }
      }
      return { success: true };
    } else {
      setExamActive(false);
      cleanupDisplayMonitoring();
      const error = (pythonProcess?.hasExited ? lastPythonStderr : getLastPythonHealthError()) || lastPythonStderr || 'AI module failed to start in exam mode. Retry the system check.';
      cleanUpPythonProcess();
      return { success: false, error };
    }
  } catch (err) {
    setExamActive(false);
    cleanupDisplayMonitoring();
    cleanUpPythonProcess();
    return { success: false, error: err.message };
  } finally { isStartingExam = false; }
});

ipcMain.handle('clear-clipboard', /* Function purpose: Clears clipboard contents to prevent carrying external text into the exam. */ () => {
  clipboard.clear();
  return true;
});
