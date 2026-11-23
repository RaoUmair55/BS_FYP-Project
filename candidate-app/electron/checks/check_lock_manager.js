const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Setup mock electron in require cache before requiring lockManager
const ipcHandlers = {};
const mockElectron = {
  app: {
    getPath: () => path.join(__dirname, '..'),
    on: () => {},
    removeListener: () => {}
  },
  ipcMain: {
    handle: (channel, handler) => {
      ipcHandlers[channel] = handler;
    }
  }
};
require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: mockElectron
};

// Test lockManager module
const { initLockManager, enableLock, disableLock, isLocked } = require('../lockManager');

console.log('--- Testing Lock Manager Unit Logic ---');

// Mock window
let windowState = {
  kiosk: false,
  fullScreen: false,
  resizable: true,
  minimizable: true,
  maximizable: true,
  closable: true,
  alwaysOnTop: false,
  menuBarVisible: true,
  listeners: {},
  webContents: {
    listeners: {},
    isDevToolsOpened: () => false,
    closeDevTools: () => {},
    send: (channel, data) => {
      windowState.lastSent = { channel, data };
    },
    on: (evt, fn) => {
      windowState.webContents.listeners[evt] = fn;
    },
    removeListener: (evt, fn) => {
      delete windowState.webContents.listeners[evt];
    }
  }
};

const mockWin = {
  setKiosk: (val) => { windowState.kiosk = val; },
  setFullScreen: (val) => { windowState.fullScreen = val; },
  setResizable: (val) => { windowState.resizable = val; },
  setMinimizable: (val) => { windowState.minimizable = val; },
  setMaximizable: (val) => { windowState.maximizable = val; },
  setClosable: (val) => { windowState.closable = val; },
  setAlwaysOnTop: (val, level) => { windowState.alwaysOnTop = val; windowState.alwaysOnTopLevel = level; },
  setMenuBarVisibility: (val) => { windowState.menuBarVisible = val; },
  focus: () => { windowState.focused = true; },
  show: () => { windowState.shown = true; },
  restore: () => { windowState.restored = true; },
  isDestroyed: () => false,
  on: (evt, fn) => { windowState.listeners[evt] = fn; },
  removeListener: (evt, fn) => { delete windowState.listeners[evt]; },
  webContents: windowState.webContents
};

// 1. Initial State
assert.strictEqual(isLocked(), false, 'Should initially be unlocked');

// 2. Initialize
initLockManager(mockWin, () => ({ sessionId: 'test-session-123', examId: 'EXAM-TEST' }));

const testExitCode = 'secretPass123';
const testHash = crypto.createHash('sha256').update(testExitCode).digest('hex');

// 3. Enable Lock
enableLock({
  examId: 'EXAM-TEST',
  endTime: new Date(Date.now() + 60000).toISOString(),
  exitCodeHash: testHash
});

assert.strictEqual(isLocked(), true, 'isLocked() should be true after enableLock');
assert.strictEqual(windowState.kiosk, true, 'Window kiosk should be true');
assert.strictEqual(windowState.fullScreen, true, 'Window fullScreen should be true');
assert.strictEqual(windowState.resizable, false, 'Window resizable should be false');
assert.strictEqual(windowState.minimizable, false, 'Window minimizable should be false');
assert.strictEqual(windowState.closable, false, 'Window closable should be false');
assert.strictEqual(windowState.alwaysOnTop, true, 'Window alwaysOnTop should be true');
assert.strictEqual(windowState.menuBarVisible, false, 'Window menuBarVisible should be false');

// 4. Test before-input-event interception
const beforeInputHandler = windowState.webContents.listeners['before-input-event'];
assert.strictEqual(typeof beforeInputHandler, 'function', 'before-input-event handler should be registered');

let prevented = false;
const mockEvent = { preventDefault: () => { prevented = true; } };

// Test Alt+F4
prevented = false;
beforeInputHandler(mockEvent, { alt: true, key: 'F4' });
assert.strictEqual(prevented, true, 'Alt+F4 should be blocked');

// Test Escape
prevented = false;
beforeInputHandler(mockEvent, { key: 'Escape' });
assert.strictEqual(prevented, true, 'Escape should be blocked');

// Test F11
prevented = false;
beforeInputHandler(mockEvent, { key: 'F11' });
assert.strictEqual(prevented, true, 'F11 should be blocked');

// Test Ctrl+Shift+I
prevented = false;
beforeInputHandler(mockEvent, { control: true, shift: true, key: 'i' });
assert.strictEqual(prevented, true, 'Ctrl+Shift+I should be blocked');

// Normal typing should not be blocked
prevented = false;
beforeInputHandler(mockEvent, { key: 'a' });
assert.strictEqual(prevented, false, 'Regular typing "a" should NOT be blocked');

// 5. Test Invigilator Exit Code Fallback & Rate Limiting
const submitCodeHandler = ipcHandlers['lock:submit-exit-code'];
assert.strictEqual(typeof submitCodeHandler, 'function', 'lock:submit-exit-code IPC handler should be registered');

(async () => {
  // Test wrong code attempt 1
  let res = await submitCodeHandler({}, 'wrongCode1');
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.rateLimited, false);
  assert.strictEqual(res.message, 'Incorrect code');
  assert.strictEqual(isLocked(), true);

  // Wrong attempts 2, 3, 4
  await submitCodeHandler({}, 'wrongCode2');
  await submitCodeHandler({}, 'wrongCode3');
  await submitCodeHandler({}, 'wrongCode4');

  // Attempt 5 -> triggers rate limiting for 30s
  res = await submitCodeHandler({}, 'wrongCode5');
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.rateLimited, true);
  assert.ok(res.message.includes('Too many attempts, wait 30s'));

  // Attempt 6 immediately after -> should be rejected with rate limit message
  res = await submitCodeHandler({}, testExitCode); // Even with correct code, must reject during lockout
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.rateLimited, true);

  // Disable lock
  disableLock('teacher');
  assert.strictEqual(isLocked(), false);

  // Re-enable and test correct exit code unlocks
  enableLock({
    examId: 'EXAM-TEST',
    endTime: new Date(Date.now() + 60000).toISOString(),
    exitCodeHash: testHash
  });
  assert.strictEqual(isLocked(), true);

  res = await submitCodeHandler({}, testExitCode);
  assert.strictEqual(res.success, true);
  assert.strictEqual(isLocked(), false, 'Correct code should unlock the app');

  // 6. Test DEV_DISABLE_LOCK=1 bypass
  process.env.DEV_DISABLE_LOCK = '1';
  enableLock({
    examId: 'EXAM-BYPASS',
    endTime: new Date(Date.now() + 60000).toISOString(),
    exitCodeHash: testHash
  });
  assert.strictEqual(isLocked(), false, 'DEV_DISABLE_LOCK=1 should prevent lock from enabling');
  process.env.DEV_DISABLE_LOCK = '0';

  console.log('PASS: All LockManager unit tests & exit code rate-limiting passed successfully!');
  process.exit(0);
})().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
