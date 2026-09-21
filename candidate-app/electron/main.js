const { app, BrowserWindow, dialog, ipcMain } = require('electron');
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
let activeSessionInfo = {
  sessionId: null,
  examId: null,
  studentId: null,
  studentName: null,
  rollNumber: null,
  consentGiven: false,
  consentTimestamp: null,
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
  const maxAttempts = 15;
  
  for (let i = 0; i < maxAttempts; i++) {
    const isReady = await checkPythonHealth();
    if (isReady) {
      console.log('[Electron] Python backend is ready!');
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

  return 'python';
}

function spawnPythonProcess(mode, isSelfCheck = false) {
  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  const pythonExe = getPythonExecutable();
  console.log(`[Electron] Spawning Python process in ${mode} mode (isSelfCheck=${isSelfCheck}): ${pythonExe} ${pythonScript}`);
  
  lastPythonStderr = '';

  // Inject session ID to the Python environment
  const pythonEnv = { 
    ...process.env, 
    EXAM_SESSION_ID: activeSessionInfo.sessionId, 
    APP_MODE: mode,
    IS_SELF_CHECK: isSelfCheck ? 'true' : 'false'
  };
  
  let proc;
  try {
    proc = spawn(pythonExe, [pythonScript], { env: pythonEnv });
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
    lastPythonStderr = (lastPythonStderr + '\n' + msg).trim();
    console.error(`[Python Error] ${msg}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && mainWindow && !proc.killedIntentional) {
      mainWindow.webContents.send('python-crashed', { code, signal, error: lastPythonStderr });
    }
  });
  
  return proc;
}

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

// Kill App
ipcMain.handle('kill-app', async (event, name) => {
  return await killApp(name);
});

// Return session info to renderer
ipcMain.handle('get-session-info', () => {
  return activeSessionInfo;
});

// Handle Login / Exam Code Entry
ipcMain.handle('login', async (event, { examId, studentId, studentName, rollNumber }) => {
  console.log(`[Electron] Candidate entering exam. Exam: ${examId}`);
  activeSessionInfo.examId = examId;
  if (studentId) activeSessionInfo.studentId = studentId;
  if (studentName) activeSessionInfo.studentName = studentName;
  if (rollNumber) activeSessionInfo.rollNumber = rollNumber;
  
  // 1. Show splash/loading screen immediately while Python spawns and health-checks
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
  }

  // 2. Spawn python in dev mode for self-check
  pythonProcess = spawnPythonProcess('dev', true);
  
  const isPythonReady = await waitForPythonReady();
  if (!isPythonReady) {
    const errorDetail = lastPythonStderr 
      ? `The AI module failed to start.\n\nDiagnostics / Error:\n${lastPythonStderr}`
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
  
  // Small delay to ensure port is freed
  const targetMode = process.env.APP_MODE === 'dev' ? 'dev' : 'exam';
  pythonProcess = spawnPythonProcess(targetMode, false);
  const isReady = await waitForPythonReady();
  
  if (isReady) {
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
      // mainWindow.webContents.openDevTools();
    }
    return { success: true };
  } else {
    return { success: false, error: 'AI module failed to start in exam mode.' };
  }
});
