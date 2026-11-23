/*
 * IntegrityFlow file overview
 * Purpose: Socket.io client in Electron main process for teacher lock commands.
 * How it works:
 * - Connects to the backend server (using process.env.SERVER_URL || 'http://localhost:5000').
 * - On connect & reconnect: emits 'candidate:join' and 'lock:request-state' with current { sessionId, examId }.
 * - Listens for 'lock:enable' from examiner -> invokes enableLock(payload).
 * - Listens for 'lock:disable' from examiner -> invokes disableLock('teacher').
 * - If disconnected while locked, STAYS LOCKED (only teacher, timer, or exit code can unlock).
 * - Automatic reconnection is handled by socket.io-client.
 * Connection: Initialized from main.js, controls lockManager.js.
 */

const { io } = require('socket.io-client');
const { enableLock, disableLock } = require('../lockManager');

let socket = null;
let sessionInfoGetter = null;

// Function purpose: Sends candidate:join and requests initial lock state from backend.
function sendJoinAndRequestState() {
  if (!socket || !socket.connected) return;

  const session = typeof sessionInfoGetter === 'function' ? sessionInfoGetter() : null;
  const sessionId = session?.sessionId || null;
  const examId = session?.examId || null;

  if (sessionId || examId) {
    console.log(`[LockSocket] Emitting candidate:join & lock:request-state for session=${sessionId}, exam=${examId}`);
    socket.emit('candidate:join', { sessionId, examId });
    socket.emit('lock:request-state', { sessionId, examId });
  } else {
    console.log('[LockSocket] Socket connected, but sessionId/examId not set yet. Will emit on login.');
  }
}

/**
 * Initializes the LockSocket client and connects to the central server.
 * @param {BrowserWindow} mainWindow
 * @param {Function} sessionGetter Function that returns current activeSessionInfo
 */
function initLockSocket(mainWindow, sessionGetter = null) {
  if (sessionGetter) {
    sessionInfoGetter = sessionGetter;
  }

  // Reuse existing SERVER_URL environment variable used across Electron
  const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
  console.log('[LockSocket] Connecting to backend server at:', serverUrl);

  socket = io(serverUrl, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000
  });

  socket.on('connect', () => {
    console.log('[LockSocket] Connected to backend server with ID:', socket.id);
    sendJoinAndRequestState();
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`[LockSocket] Reconnected to backend server (attempt #${attemptNumber})`);
    sendJoinAndRequestState();
  });

  socket.on('disconnect', (reason) => {
    console.warn('[LockSocket] Disconnected from backend server:', reason);
    // CRITICAL: If the socket disconnects while locked: STAY LOCKED.
    // Do NOT call disableLock on disconnect!
  });

  socket.on('connect_error', (error) => {
    // Avoid noisy terminal logging; socket.io retries automatically
    console.log('[LockSocket] Connection waiting / error:', error.message);
  });

  // Teacher triggered screen lockdown
  socket.on('lock:enable', (payload) => {
    console.log('[LockSocket] Received lock:enable event:', payload);
    enableLock(payload);
  });

  // Teacher triggered screen unlock
  socket.on('lock:disable', () => {
    console.log('[LockSocket] Received lock:disable event from teacher.');
    disableLock('teacher');
  });

  return socket;
}

/**
 * Call this when candidate logs in or identity captures, so candidate:join
 * is emitted without waiting for a socket reconnect.
 */
function updateLockSocketSession() {
  sendJoinAndRequestState();
}

module.exports = {
  initLockSocket,
  updateLockSocketSession
};
