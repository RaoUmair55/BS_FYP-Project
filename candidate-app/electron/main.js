const { app, BrowserWindow, dialog, ipcMain, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { startReceiver, stopReceiver } = require('./ipc/violationForwarder');
const { checkPythonHealth, forwardViolationToServer, killApp, startBufferRetryLoop, stopBufferRetryLoop, setExamActive, getExamActive } = require('./ipc/pythonBridge');
const violationBuffer = require('./ipc/violationBuffer');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// --- Added for development: Handle EPIPE / Broken pipe errors ---
// This prevents the Electron app from crashing if the parent process (like Antigravity IDE) 
// closes and standard output/error pipes are broken before this process exits.
process.on('uncaughtException', function (err) {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE: broken pipe on stdout/stderr
    return;
  }
  console.error('Unhandled Exception:', err);
});
// ----------------------------------------------------------------
let mainWindow;
let pythonProcess = null;
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

function killProcessOnPort(port = 8000) {
  if (process.platform === 'win32') {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = output.trim().split('\n');
      const pidsToKill = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
          const pid = parseInt(parts[4], 10);
          if (pid && pid !== process.pid) {
            pidsToKill.add(pid);
          }
        }
      }
      for (const pid of pidsToKill) {
        console.log(`[Electron] Freeing occupied port ${port}: terminating PID ${pid}...`);
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } catch (e) {}
      }
    } catch (e) {
      // Ignore errors when netstat has no match
    }
  }
}

function cleanUpPythonProcess() {
  if (pythonProcess) {
    console.log('[Electron] Cleaning up existing Python process...');
    pythonProcess.killedIntentional = true;
    const pid = pythonProcess.pid;
    if (process.platform === 'win32' && pid) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {}
    } else {
      try { pythonProcess.kill('SIGTERM'); } catch (e) {}
    }
    pythonProcess = null;
  }
  killProcessOnPort(8000);
}

async function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, 'assets', 'icon.ico')
    : path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    title: 'IntegrityFlow',
    icon: iconPath,
    width: 1024,
    height: 768,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Electron] Renderer process crashed/gone:', details);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[Electron] did-fail-load:', errorCode, errorDescription, validatedURL);
  });

  const targetUrl = path.join(__dirname, '../renderer/login.html');
  console.log('[Electron] Loading file:', targetUrl);
  await mainWindow.loadFile(targetUrl);
}

async function waitForPythonReady(proc) {
  console.log('[Electron] Waiting for Python backend to be ready...');
  const maxAttempts = 90; // Up to 54 seconds for heavy ML models/DLLs on cold start
  
  for (let i = 0; i < maxAttempts; i++) {
    if (proc && proc.hasExited) {
      console.error(`[Electron] Aborting health check: Python process exited prematurely with code ${proc.exitCode}.`);
      return false;
    }
    const isReady = await checkPythonHealth();
    if (isReady) {
      console.log(`[Electron] Python backend is ready on attempt ${i + 1}!`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 600)); // Poll every 600ms
  }
  
  return false;
}

let lastPythonStderr = '';

function getPythonExecutable() {
  if (process.env.PYTHON_PATH) {
    return process.env.PYTHON_PATH;
  }

  // Automatically check for local virtual environment folders (venv or .venv)
  const aiDir = path.join(__dirname, '..', 'ai-module');
  const candidateDir = path.join(__dirname, '..');
  
  const venvCandidates = [
    path.join(aiDir, 'venv', 'Scripts', 'python.exe'),
    path.join(aiDir, '.venv', 'Scripts', 'python.exe'),
    path.join(candidateDir, 'venv', 'Scripts', 'python.exe'),
    path.join(candidateDir, '.venv', 'Scripts', 'python.exe'),
    path.join(aiDir, 'venv', 'bin', 'python'),
    path.join(aiDir, '.venv', 'bin', 'python'),
    path.join(candidateDir, 'venv', 'bin', 'python'),
    path.join(candidateDir, '.venv', 'bin', 'python')
  ];

  for (const venvExe of venvCandidates) {
    if (fs.existsSync(venvExe)) {
      console.log(`[Electron] Auto-detected Python virtual environment at: ${venvExe}`);
      return venvExe;
    }
  }

  // Default to system python on PATH
  return 'python';
}

function spawnPythonProcess(mode, isSelfCheck = false) {
  cleanUpPythonProcess();

  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  const pythonExe = getPythonExecutable();
  console.log(`[Electron] Spawning Python process in ${mode} mode (isSelfCheck=${isSelfCheck}): ${pythonExe} ${pythonScript}`);
  
  lastPythonStderr = '';

  // Inject session ID and allowed applications to the Python environment
  const pythonEnv = { 
    ...process.env, 
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHON_IPC_PORT: '8000',
    EXAM_SESSION_ID: activeSessionInfo.sessionId, 
    EXAM_TYPE: activeSessionInfo.examType || 'online',
    APP_MODE: mode,
    IS_SELF_CHECK: isSelfCheck ? 'true' : 'false',
    ALLOWED_APPLICATIONS: JSON.stringify(activeSessionInfo.allowedApplications || []),
    EXAM_RULES: JSON.stringify(activeSessionInfo.rules || {})
  };
  
  let proc;
  try {
    proc = spawn(pythonExe, [pythonScript], { 
      env: pythonEnv
    });
    proc.hasExited = false;
    proc.exitCode = null;
  } catch (err) {
    lastPythonStderr = err.message;
    console.error(`[Electron] Failed to spawn ${pythonExe}:`, err);
    return null;
  }

  proc.on('error', (err) => {
    lastPythonStderr = err.message;
    console.error(`[Electron] Python spawn process error:`, err);
  });

  proc.stdout.on('data', (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    const lower = msg.toLowerCase();
    const isHarmlessWarning = lower.includes('warning') || lower.includes('info:') || lower.includes('pkg_resources') || lower.includes('deprecated');
    if (!isHarmlessWarning) {
      lastPythonStderr = (lastPythonStderr + '\n' + msg).trim();
    }
    console.log(`[Python Log] ${msg}`);
  });

  proc.on('exit', (code, signal) => {
    proc.hasExited = true;
    proc.exitCode = code;
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && mainWindow && !proc.killedIntentional) {
      mainWindow.webContents.send('python-crashed', { code, signal, error: lastPythonStderr });
    }
  });
  
  return proc;
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Electron] Unhandled Rejection:', reason);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Electron] Another instance is already running. Quitting duplicate instance...');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      console.log('[Electron] app.whenReady entered');
      cleanUpPythonProcess();
      try {
        await startReceiver((violationPayload) => {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
            const reason = violationPayload?.details?.reason || '';
            const fileName = violationPayload?.details?.fileName || '';
            if (fileName || reason.toLowerCase().includes('pre-existing')) {
              console.log('[Electron] Pre-existing file blocked! Sending alert to candidate window:', fileName);
              mainWindow.webContents.send('pre-existing-file-blocked', {
                fileName: fileName || (reason.includes(':') ? reason.split(':').pop().trim() : 'Document'),
                reason: reason,
                appName: violationPayload?.details?.object_class || 'winword.exe'
              });
            }
          }
        });
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
      startBufferRetryLoop(12000, (status) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('buffer-status-changed', status);
        }
      });
      console.log('[Electron] startBufferRetryLoop() initialized.');

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (err) {
      console.error('[Electron] Fatal error during startup:', err);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] Cleaning up processes before quit...');
  setExamActive(false);
  stopBufferRetryLoop();
  cleanUpPythonProcess();
  if (displayAddedListener) {
    screen.removeListener('display-added', displayAddedListener);
    displayAddedListener = null;
  }
  if (displayRemovedListener) {
    screen.removeListener('display-removed', displayRemovedListener);
    displayRemovedListener = null;
  }
  stopReceiver();
});

process.on('exit', () => {
  cleanUpPythonProcess();
});
process.on('SIGINT', () => {
  cleanUpPythonProcess();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanUpPythonProcess();
  process.exit(0);
});

// Returns current count of pending offline buffered violations
ipcMain.handle('get-buffer-status', () => {
  return violationBuffer.getBufferStatus();
});

// Listen for test violations from renderer
ipcMain.on('test-violation', async (event, payload) => {
  console.log('[Electron] Received test-violation from renderer:', payload);
  await forwardViolationToServer(payload);
});

// Check apps via Python
ipcMain.handle('check-apps', async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/check-apps');
    if (!response.ok) return { error: 'App check unavailable' };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-apps:', error);
    return { error: 'App check unavailable' };
  }
});

// Check USB removable storage drives via Python
ipcMain.handle('check-usb-drives', async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/check-usb');
    if (!response.ok) return { error: 'USB check unavailable' };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-usb:', error);
    return { error: 'USB check unavailable' };
  }
});

// Get display count and information via Electron screen module
ipcMain.handle('get-display-count', () => {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    count: displays.length,
    displays: displays.map(d => ({
      id: d.id,
      bounds: d.bounds,
      isPrimary: d.id === primaryDisplay.id
    }))
  };
});

// Kill App
ipcMain.handle('kill-app', async (event, name) => {
  return await killApp(name);
});

// Set Reference Voice profile via Python
ipcMain.handle('set-reference-voice', async (event, audioBase64) => {
  try {
    const response = await fetch('http://127.0.0.1:8000/set-reference-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        audio_base64: audioBase64,
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
ipcMain.handle('check-voice', async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/check-voice');
    if (!response.ok) return { calibrated: false };
    return await response.json();
  } catch (error) {
    return { calibrated: false };
  }
});

// Return session info to renderer
ipcMain.handle('get-session-info', () => {
  return activeSessionInfo;
});

let isLoggingIn = false;

// Handle Login / Exam Code Entry
ipcMain.handle('login', async (event, { examId, studentId, studentName, rollNumber, allowedApplications, examType, rules }) => {
  if (isLoggingIn) {
    console.log('[Electron] Login already in progress, ignoring duplicate invoke');
    return { success: false, error: 'Login in progress' };
  }
  isLoggingIn = true;

  console.log(`[Electron] Candidate entering exam. Exam: ${examId}, Type: ${examType}, Allowed Apps:`, allowedApplications);
  setExamActive(false);
  activeSessionInfo.examId = examId;
  if (examType) activeSessionInfo.examType = examType;
  activeSessionInfo.rules = rules || {};
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
  const targetMode = process.env.APP_MODE === 'dev' ? 'dev' : 'exam';
  pythonProcess = spawnPythonProcess(targetMode, true);
  
  const isPythonReady = await waitForPythonReady(pythonProcess);
  if (!isPythonReady) {
    isLoggingIn = false;
    const errorDetail = lastPythonStderr 
      ? `The AI module failed to start.\n\nDiagnostics / Error:\n${lastPythonStderr}`
      : 'The AI module failed to start.\n\nPlease verify that Python is in your system PATH and all dependencies are installed.';
    dialog.showErrorBox('Initialization Error', errorDetail);
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
    }
    return { success: false, error: 'AI module failed to start' };
  }

  // Send allowed applications to Python daemon
  try {
    await fetch('http://127.0.0.1:8000/configure-whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_apps: activeSessionInfo.allowedApplications || [] })
    });
  } catch (e) {
    console.warn('[Electron] Warning configuring Python whitelist:', e);
  }
  
  // 3. Python is ready -> proceed to consent screen
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/consent.html'));
  }
  isLoggingIn = false;
  return { success: true };
});

// Handle Transition from Consent Screen to Identity Screen
ipcMain.handle('proceed-to-identity', async (event, consentData) => {
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
ipcMain.handle('proceed-to-self-check', async (event, identityData) => {
  console.log('[Electron] Identity captured. Proceeding to Self-Check...', identityData);
  if (identityData) {
    activeSessionInfo.sessionId = identityData.sessionId;
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
ipcMain.handle('decline-consent', async () => {
  console.log('[Electron] Candidate declined monitoring consent. Gracefully quitting...');
  cleanUpPythonProcess();
  stopReceiver();
  app.quit();
  return { success: true };
});

// Start Exam Mode
ipcMain.handle('start-exam-mode', async () => {
  console.log('[Electron] Transitioning to Exam Mode...');
  cleanUpPythonProcess();
  
  // Clean up any existing screen listeners before registering fresh ones
  if (displayAddedListener) {
    screen.removeListener('display-added', displayAddedListener);
    displayAddedListener = null;
  }
  if (displayRemovedListener) {
    screen.removeListener('display-removed', displayRemovedListener);
    displayRemovedListener = null;
  }

  // Register display addition listener for continuous monitoring during active exam
  displayAddedListener = async (event, newDisplay) => {
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

  displayRemovedListener = (event, oldDisplay) => {
    console.log(`[Electron] Display removed during exam. Total displays remaining: ${screen.getAllDisplays().length}`);
  };
  screen.on('display-removed', displayRemovedListener);

  // Small delay to ensure port is freed
  const targetMode = process.env.APP_MODE === 'dev' ? 'dev' : 'exam';
  pythonProcess = spawnPythonProcess(targetMode, false);
  const isReady = await waitForPythonReady(pythonProcess);
  
  if (isReady) {
    // Re-send allowed applications to newly spawned exam-mode daemon
    try {
      await fetch('http://127.0.0.1:8000/configure-whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_apps: activeSessionInfo.allowedApplications || [] })
      });
    } catch (e) {
      console.warn('[Electron] Warning configuring Python whitelist in exam mode:', e);
    }

    if (mainWindow) {
      clipboard.clear();
      await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
      // Officially activate live proctoring & violation capture now that examScreen is active
      setExamActive(true);
    }
    return { success: true };
  } else {
    setExamActive(false);
    return { success: false, error: 'AI module failed to start in exam mode.' };
  }
});

ipcMain.handle('clear-clipboard', () => {
  clipboard.clear();
  return true;
});
