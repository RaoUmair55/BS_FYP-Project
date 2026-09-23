const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { startReceiver, stopReceiver } = require('./ipc/violationForwarder');
const { checkPythonHealth, forwardViolationToServer, killApp } = require('./ipc/pythonBridge');
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
let pythonProcess;
let displayAddedListener = null;
let displayRemovedListener = null;
let activeSessionInfo = {
  sessionId: null,
  examId: null,
  studentId: null,
  studentName: null,
  rollNumber: null,
  consentGiven: false,
  consentTimestamp: null,
  allowedApplications: [],
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000'
};

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
      plugins: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await mainWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
  // mainWindow.webContents.openDevTools();
}

async function waitForPythonReady() {
  console.log('[Electron] Waiting for Python backend to be ready...');
  const maxAttempts = 25;
  
  for (let i = 0; i < maxAttempts; i++) {
    const isReady = await checkPythonHealth();
    if (isReady) {
      console.log(`[Electron] Python backend is ready on attempt ${i + 1}!`);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every 1 second
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
  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  const pythonExe = getPythonExecutable();
  console.log(`[Electron] Spawning Python process in ${mode} mode (isSelfCheck=${isSelfCheck}): ${pythonExe} ${pythonScript}`);
  
  lastPythonStderr = '';

  // Inject session ID and allowed applications to the Python environment
  const pythonEnv = { 
    ...process.env, 
    PYTHONUNBUFFERED: '1',
    EXAM_SESSION_ID: activeSessionInfo.sessionId, 
    APP_MODE: mode,
    IS_SELF_CHECK: isSelfCheck ? 'true' : 'false',
    ALLOWED_APPLICATIONS: JSON.stringify(activeSessionInfo.allowedApplications || [])
  };
  
  let proc;
  try {
    proc = spawn(pythonExe, [pythonScript], { 
      env: pythonEnv
    });
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
    if (!msg.includes('INFO:') && !msg.includes('WARNING:')) {
      lastPythonStderr = (lastPythonStderr + '\n' + msg).trim();
    }
    console.log(`[Python Log] ${msg}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && mainWindow && !proc.killedIntentional) {
      mainWindow.webContents.send('python-crashed', { code, signal, error: lastPythonStderr });
    }
  });
  
  return proc;
}

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
    // STARTUP ORDER 1: Start the local Express receiver first
    try {
      await startReceiver();
    } catch (error) {
      dialog.showErrorBox('Initialization Error', 'Failed to start local violation receiver. ' + error.message);
      app.quit();
      return;
    }

    // STARTUP ORDER 2: Create the BrowserWindow directly (Python spawns after login)
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] Cleaning up processes before quit...');
  if (pythonProcess) {
    pythonProcess.killedIntentional = true;
    pythonProcess.kill('SIGTERM'); // kill python child process cleanly
  }
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

// Listen for test violations from renderer
ipcMain.on('test-violation', async (event, payload) => {
  console.log('[Electron] Received test-violation from renderer:', payload);
  await forwardViolationToServer(payload);
});

// Check apps via Python
ipcMain.handle('check-apps', async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/check-apps');
    if (!response.ok) return { unauthorized_apps: [] };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-apps:', error);
    return { unauthorized_apps: [] };
  }
});

// Check USB removable storage drives via Python
ipcMain.handle('check-usb-drives', async () => {
  try {
    const response = await fetch('http://127.0.0.1:8000/check-usb');
    if (!response.ok) return { removable_drives: [] };
    return await response.json();
  } catch (error) {
    console.error('[Electron] Error fetching /check-usb:', error);
    return { removable_drives: [] };
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

// Return session info to renderer
ipcMain.handle('get-session-info', () => {
  return activeSessionInfo;
});

let isLoggingIn = false;

// Handle Login / Exam Code Entry
ipcMain.handle('login', async (event, { examId, studentId, studentName, rollNumber, allowedApplications }) => {
  if (isLoggingIn) {
    console.log('[Electron] Login already in progress, ignoring duplicate invoke');
    return { success: false, error: 'Login in progress' };
  }
  isLoggingIn = true;

  console.log(`[Electron] Candidate entering exam. Exam: ${examId}, Allowed Apps:`, allowedApplications);
  activeSessionInfo.examId = examId;
  if (studentId) activeSessionInfo.studentId = studentId;
  if (studentName) activeSessionInfo.studentName = studentName;
  if (rollNumber) activeSessionInfo.rollNumber = rollNumber;
  if (allowedApplications && Array.isArray(allowedApplications)) {
    activeSessionInfo.allowedApplications = allowedApplications;
  }
  
  // Clean up any previously running Python child process before spawning a new one
  if (pythonProcess) {
    console.log('[Electron] Cleaning up existing Python process before spawning fresh one...');
    pythonProcess.killedIntentional = true;
    try { pythonProcess.kill('SIGTERM'); } catch (e) {}
    pythonProcess = null;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 1. Show splash/loading screen immediately while Python spawns and health-checks
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
  }

  // 2. Spawn python in configured mode (exam/dev) for self-check
  const targetMode = process.env.APP_MODE === 'dev' ? 'dev' : 'exam';
  pythonProcess = spawnPythonProcess(targetMode, true);
  
  const isPythonReady = await waitForPythonReady();
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
  if (pythonProcess) {
    pythonProcess.killedIntentional = true;
    pythonProcess.kill('SIGTERM');
  }
  stopReceiver();
  app.quit();
  return { success: true };
});

// Start Exam Mode
ipcMain.handle('start-exam-mode', async () => {
  console.log('[Electron] Transitioning to Exam Mode...');
  if (pythonProcess) {
    pythonProcess.killedIntentional = true;
    pythonProcess.kill('SIGTERM');
  }
  
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
  const isReady = await waitForPythonReady();
  
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
      await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
      // mainWindow.webContents.openDevTools();
    }
    return { success: true };
  } else {
    return { success: false, error: 'AI module failed to start in exam mode.' };
  }
});
