const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { startReceiver, stopReceiver } = require('./ipc/violationForwarder');
const { checkPythonHealth, forwardViolationToServer } = require('./ipc/pythonBridge');

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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await mainWindow.loadFile(path.join(__dirname, '../renderer/examScreen.html'));
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

app.whenReady().then(async () => {
  // STARTUP ORDER 1: Start the local Express receiver first
  try {
    await startReceiver();
  } catch (error) {
    dialog.showErrorBox('Initialization Error', 'Failed to start local violation receiver. ' + error.message);
    app.quit();
    return;
  }

  // STARTUP ORDER 2: Spawn Python Process
  const pythonScript = path.join(__dirname, '..', 'ai-module', 'main.py');
  console.log(`[Electron] Spawning Python process: python ${pythonScript}`);
  
  // Inject session ID to the Python environment
  const pythonEnv = { ...process.env, EXAM_SESSION_ID: 'dummy-session-123' };
  pythonProcess = spawn('python', [pythonScript], { env: pythonEnv });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
  });

  pythonProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Python process exited with code ${code} and signal ${signal}`);
    if (code !== 0 && mainWindow) {
      mainWindow.webContents.send('python-crashed', { code, signal });
    }
  });

  // STARTUP ORDER 3: Wait for Python to be ready
  const isPythonReady = await waitForPythonReady();
  if (!isPythonReady) {
    dialog.showErrorBox('Initialization Error', 'The AI module failed to start within the expected time. Please check logs and restart the app.');
    if (pythonProcess) pythonProcess.kill();
    stopReceiver();
    app.quit();
    return;
  }

  // STARTUP ORDER 4: Create the BrowserWindow
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
    pythonProcess.kill('SIGTERM'); // kill python child process cleanly
  }
  stopReceiver();
});

// Listen for test violations from renderer
ipcMain.on('test-violation', async (event, payload) => {
  console.log('[Electron] Received test-violation from renderer:', payload);
  await forwardViolationToServer(payload);
});
