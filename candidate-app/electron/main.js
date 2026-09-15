const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
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
  serverUrl: process.env.SERVER_URL || 'http://localhost:5000'
};

async function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.webContents.openDevTools();
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

function spawnPythonProcess(mode) {
  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  console.log(`[Electron] Spawning Python process in ${mode} mode: python ${pythonScript}`);
  
  // Inject session ID to the Python environment
  const pythonEnv = { ...process.env, EXAM_SESSION_ID: activeSessionInfo.sessionId, APP_MODE: mode };
  const proc = spawn('python', [pythonScript], { env: pythonEnv });

  proc.stdout.on('data', (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  proc.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  proc.on('exit', (code, signal) => {
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && mainWindow && !proc.killedIntentional) {
      mainWindow.webContents.send('python-crashed', { code, signal });
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

// Handle Login
ipcMain.handle('login', async (event, { sessionId, examId }) => {
  console.log(`[Electron] Login successful. Session: ${sessionId}, Exam: ${examId}`);
  activeSessionInfo.sessionId = sessionId;
  activeSessionInfo.examId = examId;
  
  // Now spawn python in dev mode
  pythonProcess = spawnPythonProcess('dev');
  
  const isPythonReady = await waitForPythonReady();
  if (!isPythonReady) {
    dialog.showErrorBox('Initialization Error', 'The AI module failed to start.');
    return { success: false, error: 'AI module failed to start' };
  }
  
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/selfCheck.html'));
  }
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
  await new Promise(r => setTimeout(r, 1000));
  
  pythonProcess = spawnPythonProcess('exam');
  const isReady = await waitForPythonReady();
  
  if (isReady) {
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
      mainWindow.webContents.openDevTools();
    }
    return { success: true };
  } else {
    return { success: false, error: 'AI module failed to start in exam mode.' };
  }
});
