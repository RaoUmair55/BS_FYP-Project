/*
 * IntegrityFlow file overview
 * Purpose: Screen Lock (Exam Lockdown) Manager for Candidate Electron Application (Windows).
 * How it works:
 * - Places the main application window in kiosk and fullscreen mode with always-on-top ("screen-saver").
 * - Blocks destructive window actions (minimize, close, leave fullscreen, keyboard shortcuts like Alt+F4, F11, Esc, DevTools).
 * - Detects focus loss (blur from Alt+Tab, Windows key, etc.), immediately re-claims focus, and logs a debounced violation.
 * - Persists lock state to disk (lock-state.json) for crash recovery mid-exam.
 * - Handles timed auto-unlock when exam endTime passes and invigilator manual exit-code fallback with SHA-256 and rate limiting.
 * - Supports DEV_DISABLE_LOCK=1 environment flag for safe local development.
 * Connection: Initialized from main.js, triggered by lockSocket.js (network events) and preload.js (IPC).
 */

const electron = typeof require('electron') === 'object' && require('electron') !== null ? require('electron') : {};
const app = electron.app;
const ipcMain = electron.ipcMain;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { forwardViolationToServer } = require('./ipc/pythonBridge');

// Internal state variables
let win = null;
let sessionInfoGetter = null;
let locked = false;
let allowQuit = false;

let currentExamId = null;
let currentEndTime = null;
let currentExitCodeHash = null;

let lockTimer = null;
let lastBlurReportTime = 0;

// Rate limiting state for invigilator exit code attempts
let failedExitCodeAttempts = 0;
let exitCodeLockoutUntil = 0;

// Path to persistent lock file in user data directory
function getLockFilePath() {
  const baseDir = (app && typeof app.getPath === 'function')
    ? app.getPath('userData')
    : path.join(__dirname, '..');
  return path.join(baseDir, 'lock-state.json');
}

// Function purpose: Returns whether the exam lockdown is currently active.
function isLocked() {
  return locked;
}

// Function purpose: Saves active lock state to disk so crashes or restarts mid-exam re-apply lock.
function saveLockState() {
  try {
    const filePath = getLockFilePath();
    const data = {
      locked: true,
      examId: currentExamId,
      endTime: currentEndTime,
      exitCodeHash: currentExitCodeHash
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log('[LockManager] Lock state saved to disk:', filePath);
  } catch (err) {
    console.error('[LockManager] Failed to write lock state file:', err.message);
  }
}

// Function purpose: Deletes the persistent lock state file when the exam is unlocked.
function deleteLockStateFile() {
  try {
    const filePath = getLockFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[LockManager] Lock state file deleted from disk.');
    }
  } catch (err) {
    console.error('[LockManager] Failed to remove lock state file:', err.message);
  }
}

// Event handler: Prevent window close while locked
function onWindowClose(event) {
  if (locked && !allowQuit) {
    console.log('[LockManager] Window close blocked by exam lock.');
    event.preventDefault();
  }
}

// Event handler: Prevent minimize while locked; immediately restore and focus
function onWindowMinimize(event) {
  if (locked) {
    console.log('[LockManager] Window minimize blocked. Restoring and focusing window...');
    event.preventDefault();
    if (win && !win.isDestroyed()) {
      win.restore();
      win.focus();
    }
  }
}

// Event handler: Prevent leaving fullscreen while locked
function onLeaveFullScreen() {
  if (locked && win && !win.isDestroyed()) {
    console.log('[LockManager] Window left fullscreen. Re-entering fullscreen...');
    win.setFullScreen(true);
  }
}

// Event handler: Prevent Electron app from quitting while locked unless allowQuit is true
function onAppBeforeQuit(event) {
  if (locked && !allowQuit) {
    console.log('[LockManager] App before-quit blocked by active exam lock.');
    event.preventDefault();
  }
}

// Event handler: Intercept destructive keyboard shortcuts
// Blocks: Alt+F4, F11, Escape, Ctrl+W, Ctrl+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+R
function onBeforeInputEvent(event, input) {
  if (!locked) return;

  const key = (input.key || '').toLowerCase();
  const isAlt = Boolean(input.alt);
  const isCtrl = Boolean(input.control || input.meta);
  const isShift = Boolean(input.shift);

  if (
    (isAlt && key === 'f4') ||
    key === 'f11' ||
    key === 'escape' ||
    (isCtrl && key === 'w') ||
    (isCtrl && key === 'r') ||
    key === 'f5' ||
    (isCtrl && isShift && key === 'i') ||
    key === 'f12' ||
    (isCtrl && isShift && key === 'r')
  ) {
    event.preventDefault();
  }
}

// Event handler: Close DevTools immediately if opened while locked
function onDevToolsOpened() {
  if (locked && win && !win.isDestroyed() && win.webContents) {
    console.log('[LockManager] DevTools opened while locked. Forcing DevTools closed.');
    try {
      win.webContents.closeDevTools();
    } catch (e) {}
  }
}

// Function purpose: Sends a focus-loss violation to the server via pythonBridge.
function reportFocusLostViolation() {
  try {
    const session = typeof sessionInfoGetter === 'function' ? sessionInfoGetter() : null;
    const sessionId = session?.sessionId || currentExamId || 'unknown-session';

    const violationPayload = {
      sessionId: sessionId,
      type: 'window_focus_lost',
      severity: 2,
      timestamp: new Date().toISOString(),
      details: {
        duration: 0
      },
      screenshotPath: null
    };

    console.log('[LockManager] Sending window_focus_lost violation:', violationPayload);
    // Use existing forwardViolationToServer with durableFirst=true to ensure delivery/buffering
    forwardViolationToServer(violationPayload, true).catch((err) => {
      console.warn('[LockManager] Failed to forward focus loss violation:', err.message);
    });
  } catch (err) {
    console.error('[LockManager] Error constructing focus lost violation:', err.message);
  }
}

// Event handler: Handle window focus loss (blur) during exam lock
function onWindowBlur() {
  if (!locked || !win || win.isDestroyed()) return;

  console.log('[LockManager] Focus lost (blur) while locked. Reclaiming focus and restoring window...');
  try {
    win.show();
    win.focus();
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch (err) {
    console.error('[LockManager] Error reclaiming window focus:', err.message);
  }

  // Debounce violation reporting to at most one alert every 5 seconds
  const now = Date.now();
  if (now - lastBlurReportTime >= 5000) {
    lastBlurReportTime = now;
    reportFocusLostViolation();
  }
}

// Function purpose: Attaches all lockdown event guards to the main window.
function attachGuards() {
  if (!win || win.isDestroyed()) return;

  detachGuards(); // Avoid duplicate listeners

  win.on('close', onWindowClose);
  win.on('minimize', onWindowMinimize);
  win.on('leave-full-screen', onLeaveFullScreen);
  win.on('blur', onWindowBlur);
  if (app && typeof app.on === 'function') {
    app.on('before-quit', onAppBeforeQuit);
  }

  if (win.webContents) {
    win.webContents.on('before-input-event', onBeforeInputEvent);
    win.webContents.on('devtools-opened', onDevToolsOpened);
    if (typeof win.webContents.isDevToolsOpened === 'function' && win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    }
  }
}

// Function purpose: Removes all lockdown event guards from the window.
function detachGuards() {
  if (win && !win.isDestroyed()) {
    win.removeListener('close', onWindowClose);
    win.removeListener('minimize', onWindowMinimize);
    win.removeListener('leave-full-screen', onLeaveFullScreen);
    win.removeListener('blur', onWindowBlur);

    if (win.webContents) {
      win.webContents.removeListener('before-input-event', onBeforeInputEvent);
      win.webContents.removeListener('devtools-opened', onDevToolsOpened);
    }
  }
  if (app && typeof app.removeListener === 'function') {
    app.removeListener('before-quit', onAppBeforeQuit);
  }
}

/**
 * Enables application-level screen lock.
 * @param {Object} payload { examId, endTime (ISO string), exitCodeHash (SHA-256 hex string) }
 */
function enableLock(payload = {}) {
  // Check development bypass flag
  if (process.env.DEV_DISABLE_LOCK === '1') {
    console.log('[LockManager] DEV_DISABLE_LOCK=1 is active: enableLock skipped (no-op).');
    return;
  }

  const { examId, endTime, exitCodeHash } = payload;
  console.log(`[LockManager] Enabling screen lock for examId: ${examId}, endTime: ${endTime}`);

  locked = true;
  allowQuit = false;
  currentExamId = examId || currentExamId;
  currentEndTime = endTime || currentEndTime;
  currentExitCodeHash = exitCodeHash || currentExitCodeHash;

  // 1. Lock window properties
  if (win && !win.isDestroyed()) {
    win.setMenuBarVisibility(false);
    win.setFullScreen(true);
    win.setKiosk(true);
    win.setResizable(false);
    win.setMinimizable(false);
    win.setMaximizable(false);
    win.setClosable(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
  }

  // 2. Attach security guards
  attachGuards();

  // 3. Save lock state to JSON file for crash recovery
  saveLockState();

  // 4. Timer: auto-unlock when endTime passes
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }

  if (currentEndTime) {
    const endMs = new Date(currentEndTime).getTime();
    const remainingMs = endMs - Date.now();
    if (remainingMs <= 0) {
      console.log('[LockManager] Exam endTime has already passed. Triggering automatic unlock...');
      disableLock('exam-time-ended');
      return;
    } else {
      console.log(`[LockManager] Timer scheduled to auto-unlock in ${Math.round(remainingMs / 1000)} seconds.`);
      lockTimer = setTimeout(() => {
        console.log('[LockManager] Exam end time reached. Auto-unlocking screen...');
        disableLock('exam-time-ended');
      }, remainingMs);
    }
  }

  // 5. Notify renderer of lock activation
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send('lock:state', {
      locked: true,
      examId: currentExamId,
      endTime: currentEndTime
    });
  }
}

/**
 * Disables application-level screen lock and restores window state.
 * @param {string} reason 'teacher' | 'exam-time-ended' | 'exit-code' | 'exam-ended' | 'manual'
 */
function disableLock(reason = 'manual') {
  console.log(`[LockManager] Disabling screen lock. Reason: ${reason}`);

  locked = false;
  allowQuit = true;

  // Clear timer
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }

  // Remove event guards
  detachGuards();

  // Remove persistent lock state file
  deleteLockStateFile();

  // Reset rate limiting
  failedExitCodeAttempts = 0;
  exitCodeLockoutUntil = 0;

  // Undo window lockdown properties in reverse order
  if (win && !win.isDestroyed()) {
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setResizable(true);
    win.setMinimizable(true);
    win.setMaximizable(true);
    win.setClosable(true);
    win.setAlwaysOnTop(false);
    win.setMenuBarVisibility(true);

    // Notify renderer that lock is removed
    if (win.webContents) {
      win.webContents.send('lock:state', {
        locked: false,
        reason: reason
      });
    }
  }
}

/**
 * Validates invigilator exit code against stored exitCodeHash.
 * Rate limited to 5 failed attempts per 30 seconds.
 */
function handleExitCodeSubmission(code) {
  if (!locked) {
    return { success: true, message: 'Screen is not currently locked.' };
  }

  const now = Date.now();
  // Check active lockout
  if (exitCodeLockoutUntil && now < exitCodeLockoutUntil) {
    const remainingSec = Math.ceil((exitCodeLockoutUntil - now) / 1000);
    return {
      success: false,
      rateLimited: true,
      message: `Too many attempts, wait 30s (${remainingSec}s remaining)`
    };
  }

  if (!code || typeof code !== 'string') {
    return { success: false, message: 'Invalid code provided.' };
  }

  // Hash submitted code with SHA-256 (never store or log plain code)
  const submittedHash = crypto.createHash('sha256').update(code.trim()).digest('hex').toLowerCase();
  const expectedHash = (currentExitCodeHash || '').toLowerCase();

  console.log('[LockManager] Verifying exit code hash...');
  if (expectedHash && submittedHash === expectedHash) {
    console.log('[LockManager] Invigilator exit code accepted! Unlocking screen...');
    failedExitCodeAttempts = 0;
    exitCodeLockoutUntil = 0;
    disableLock('exit-code');
    return { success: true };
  } else {
    failedExitCodeAttempts++;
    console.warn(`[LockManager] Incorrect exit code attempt (${failedExitCodeAttempts}/5)`);
    if (failedExitCodeAttempts >= 5) {
      exitCodeLockoutUntil = Date.now() + 30000;
      failedExitCodeAttempts = 0;
      return {
        success: false,
        rateLimited: true,
        message: 'Too many attempts, wait 30s'
      };
    }
    return {
      success: false,
      rateLimited: false,
      message: 'Incorrect code'
    };
  }
}

/**
 * Initializes the Lock Manager with the main application window and session getter.
 * Restores any unexpired lock found in lock-state.json on startup.
 */
function initLockManager(mainWindow, sessionGetter = null) {
  win = mainWindow;
  if (sessionGetter) {
    sessionInfoGetter = sessionGetter;
  }

  // Register IPC handlers if running inside Electron main process
  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle('lock:submit-exit-code', async (_event, code) => {
      return handleExitCodeSubmission(code);
    });

    ipcMain.handle('lock:get-state', () => {
      return {
        locked: locked,
        examId: currentExamId,
        endTime: currentEndTime
      };
    });
  }

  // Re-emit lock state to renderer when it finishes loading
  if (win && win.webContents) {
    win.webContents.on('did-finish-load', () => {
      if (locked) {
        win.webContents.send('lock:state', {
          locked: true,
          examId: currentExamId,
          endTime: currentEndTime
        });
      }
    });
  }

  // Check persistent lock state file on startup
  const lockFilePath = getLockFilePath();
  if (fs.existsSync(lockFilePath)) {
    try {
      const raw = fs.readFileSync(lockFilePath, 'utf8');
      const saved = JSON.parse(raw);
      if (saved && saved.locked && saved.endTime) {
        const endMs = new Date(saved.endTime).getTime();
        if (endMs > Date.now()) {
          if (process.env.DEV_DISABLE_LOCK === '1') {
            console.log('[LockManager] DEV_DISABLE_LOCK=1: Skipping saved lock recovery.');
          } else {
            console.log('[LockManager] Active saved lock found from previous session. Re-applying lock on startup...');
            enableLock(saved);
          }
        } else {
          console.log('[LockManager] Saved lock endTime has already passed. Clearing lock-state.json.');
          deleteLockStateFile();
        }
      }
    } catch (err) {
      console.error('[LockManager] Error recovering saved lock state:', err.message);
      deleteLockStateFile();
    }
  }
}

module.exports = {
  initLockManager,
  enableLock,
  disableLock,
  isLocked
};
