/*
 * IntegrityFlow file overview
 * Purpose: Communication and delivery helper for Electron.
 * How it works: Calls the local Python health/process endpoints and uploads violation records and
 * evidence to the central server. Persists failed or durable-first deliveries and retries the 
 * offline buffer without overlapping retry runs.
 * Connection: Uses violationBuffer.js; main.js supplies the discovered Python port,
 * session bearer token, and exam-active state.
 */
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const FormData = require('form-data');
const fs = require('fs');
const { randomUUID, createHash } = require('node:crypto');
const violationBuffer = require('./violationBuffer');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

let pythonPort = null;
let lastHealthError = '';
// Function purpose: Stores the dynamically assigned port used to contact the local Python backend.
function setPythonPort(port) {
  pythonPort = port;
  lastHealthError = '';
}
// Function purpose: Builds the local Python URL using the current backend port.
function getPythonUrl() {
  if (!Number.isInteger(pythonPort) || pythonPort < 1 || pythonPort > 65535) throw new Error('AI module is not ready. Retry the system check.');
  return `http://127.0.0.1:${pythonPort}`;
}
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

let retryIntervalTimer = null;
let wasOffline = false;
let statusChangeCallback = null;
let isExamActive = false;
let bufferDrainRunning = false;
let currentSessionToken = null;
const sessionTokens = new Map();
let localIpcSecret = null;
let allowedScreenshotRoot = path.resolve(__dirname, '..', '..', 'ai-module', 'screenshots');
let allowedAudioRoot = path.resolve(__dirname, '..', '..', 'ai-module', 'audio_evidence');

const ALLOWED_SCREENSHOT_EXTS = new Set(['.jpg', '.jpeg', '.png']);
const ALLOWED_AUDIO_EXTS = new Set(['.wav']);

// Function purpose: Stores the per-launch IPC secret shared between Electron and local Python sidecar.
function setLocalIpcSecret(secret) {
  localIpcSecret = typeof secret === 'string' && secret.trim() ? secret.trim() : null;
}

// Function purpose: Returns headers authenticating Electron -> local Python FastAPI calls.
function getLocalIpcHeaders(extra = {}) {
  return {
    ...(localIpcSecret ? { 'X-IntegrityFlow-IPC-Token': localIpcSecret } : {}),
    ...extra
  };
}

// Function purpose: Allows isolated unit checks to direct evidence roots to a controlled temp directory.
function setAllowedEvidenceRoots({ screenshotRoot, audioRoot } = {}) {
  if (screenshotRoot) allowedScreenshotRoot = path.resolve(screenshotRoot);
  if (audioRoot) allowedAudioRoot = path.resolve(audioRoot);
}

// Function purpose: Enforces path.relative() + realpath containment and extension allowlisting.
function isPathWithinRoot(filePath, rootDir, allowedExts = null) {
  if (typeof filePath !== 'string' || !filePath.trim()) return false;
  try {
    const resolvedRoot = fs.existsSync(rootDir) ? fs.realpathSync(rootDir) : path.resolve(rootDir);
    const resolvedTarget = path.resolve(filePath);
    if (!fs.existsSync(resolvedTarget)) return false;
    const realTarget = fs.realpathSync(resolvedTarget);
    const rel = path.relative(resolvedRoot, realTarget);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    if (allowedExts && !allowedExts.has(path.extname(realTarget).toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

// Function purpose: Stores the candidate session Bearer token for authenticated violation delivery.
function setSessionToken(sessionId, token) {
  currentSessionToken = token || null;
  if (sessionId && token) {
    sessionTokens.set(String(sessionId), token);
  }
}

// Function purpose: Resolves the candidate session Bearer token for a given session ID.
function getSessionToken(sessionId) {
  if (sessionId && sessionTokens.has(String(sessionId))) {
    return sessionTokens.get(String(sessionId));
  }
  return currentSessionToken;
}

// Function purpose: Updates whether exam monitoring is currently active.
function setExamActive(active) {
  isExamActive = Boolean(active);
  console.log(`[PythonBridge] Active exam state updated to: ${isExamActive}`);
}

// Function purpose: Returns whether the candidate is currently in an active exam.
function getExamActive() {
  return isExamActive;
}

// Function purpose: Checks whether the local Python backend is reachable and reports its health.
async function checkPythonHealth(instanceId) {
  try {
    const response = await axios.get(`${getPythonUrl()}/health`, {
      timeout: 2000,
      proxy: false,
      headers: getLocalIpcHeaders()
    });
    lastHealthError = (response.data.errors || []).join('; ');
    return response.status === 200 && response.data.status === 'ok' && response.data.instanceId === instanceId;
  } catch (error) {
    console.log(`[Electron] Python health check waiting (${error.code || error.message})...`);
    return false;
  }
}

/**
 * Direct single-shot HTTP transport to POST /violation.
 * Preserves the exact original timestamp in the payload and authenticates via Bearer sessionToken.
 *
 * @param {Object} violationPayload
 * @returns {Promise<boolean>}
 */
// Function purpose: Attempts to deliver a violation directly to the exam server.
async function sendViolationDirect(violationPayload) {
  // Assign once before delivery so buffering preserves the same event on a lost acknowledgement.
  violationPayload.eventId ||= randomUUID();
  violationPayload.timestamp ||= new Date().toISOString();
  const authToken = violationPayload.sessionToken || getSessionToken(violationPayload.sessionId);
  const { sessionToken: _omittedToken, ...cleanPayload } = violationPayload;
  let requestData = cleanPayload;
  let requestHeaders = {};

  const screenshot = cleanPayload.screenshotPath;
  const audio = cleanPayload.audioPath || cleanPayload.details?.audioPath;

  const resolvedScreenshot = typeof screenshot === 'string' ? path.resolve(screenshot) : '';
  const resolvedAudio = typeof audio === 'string' ? path.resolve(audio) : '';

  const hasValidScreenshot = isPathWithinRoot(resolvedScreenshot, allowedScreenshotRoot, ALLOWED_SCREENSHOT_EXTS);
  const hasValidAudio = isPathWithinRoot(resolvedAudio, allowedAudioRoot, ALLOWED_AUDIO_EXTS);

  if (screenshot && !hasValidScreenshot) {
    console.warn(`[PythonBridge] Blocked screenshotPath outside allowed evidence root: ${screenshot}`);
    delete cleanPayload.screenshotPath;
  }
  if (audio && !hasValidAudio) {
    console.warn(`[PythonBridge] Blocked audioPath outside allowed evidence root: ${audio}`);
    delete cleanPayload.audioPath;
  }

  if (hasValidScreenshot || hasValidAudio) {
    const form = new FormData();
    form.append('sessionId', cleanPayload.sessionId);
    form.append('eventId', cleanPayload.eventId);
    form.append('type', cleanPayload.type);
    form.append('severity', String(cleanPayload.severity));
    form.append('timestamp', cleanPayload.timestamp || new Date().toISOString());
    if (cleanPayload.details) {
      form.append('details', typeof cleanPayload.details === 'string' ? cleanPayload.details : JSON.stringify(cleanPayload.details));
    }
    if (hasValidScreenshot) {
      form.append('screenshot', fs.createReadStream(resolvedScreenshot), {
        filename: path.basename(resolvedScreenshot),
        contentType: 'image/jpeg'
      });
    }
    if (hasValidAudio) {
      form.append('audio', fs.createReadStream(resolvedAudio), {
        filename: path.basename(resolvedAudio),
        contentType: 'audio/wav'
      });
    }

    requestData = form;
    requestHeaders = form.getHeaders();
  }

  if (authToken) {
    requestHeaders = { ...requestHeaders, Authorization: `Bearer ${authToken}` };
  }

  const deliveryStarted = Date.now();
  try {
    const response = await axios.post(`${SERVER_URL}/violation`, requestData, {
      timeout: 8000,
      headers: requestHeaders
    });
    console.log(`[Alert Delivery] ${cleanPayload.type}: server accepted after ${Date.now() - deliveryStarted}ms; event age ${Date.now() - Date.parse(cleanPayload.timestamp)}ms`);
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    if (err.response && (err.response.status === 404 || err.response.status === 400 || err.response.status === 401)) {
      // Invalid/stale/expired session on backend - treat as consumed so it doesn't poison the retry loop
      console.warn(`[PythonBridge] Server rejected invalid event/session (${err.response.status}): ${err.response.data?.error || 'Invalid data'}. Discarding from queue.`);
      return true;
    }
    throw err;
  }
}

/**
 * Forwards a violation event to the backend. If network transport fails,
 * the event is automatically enqueued into the SQLite disk-backed offline buffer.
 *
 * @param {Object} violationPayload
 * @returns {Promise<boolean>}
 */
// Function purpose: Forwards a monitoring event to the server and preserves it for retry if delivery fails.
async function forwardViolationToServer(violationPayload, durableFirst = false) {
  if (!isExamActive && !durableFirst) {
    console.log(`[PythonBridge] Pre-exam violation ignored: ${violationPayload?.type} (Exam not started yet)`);
    return false;
  }

  const resolvedToken = violationPayload.sessionToken || getSessionToken(violationPayload.sessionId);
  if (resolvedToken && !violationPayload.sessionToken) {
    violationPayload.sessionToken = resolvedToken;
  }

  if (durableFirst) {
    try {
      violationPayload.eventId ||= randomUUID();
      violationPayload.timestamp ||= new Date().toISOString();
      violationBuffer.enqueue(violationPayload, violationPayload.screenshotPath);
      notifyStatusChange();
      setImmediate(/* Function purpose: Runs processOfflineBuffer as part of this callback’s processing. */ () => processOfflineBuffer());
      return true;
    } catch (error) {
      console.error('[PythonBridge] Could not persist incoming alert:', error);
      return false;
    }
  }

  try {
    console.log(`[PythonBridge] Forwarding violation to backend:`, violationPayload.type);
    const success = await sendViolationDirect(violationPayload);
    if (success) {
      console.log(`[PythonBridge] Successfully forwarded violation to backend.`);
      return true;
    }
  } catch (error) {
    console.warn(`[PythonBridge] Network delivery failed (${error.code || error.message}). Buffering to local SQLite database...`);
  }

  // Network transport failed -> Save to local SQLite disk buffer
  try {
    const rowId = violationBuffer.enqueue(violationPayload, violationPayload.screenshotPath);
    console.log(`[PythonBridge] Violation safely stored in offline buffer (Row ID: ${rowId}).`);
    notifyStatusChange();
    return true;
  } catch (dbErr) {
    console.error(`[PythonBridge] Failed to enqueue violation to disk buffer:`, dbErr);
  }

  return false;
}

/**
 * Executes a single drainage pass over the offline buffer, oldest first.
 */
// Function purpose: Retries pending locally stored violations without losing their event identity.
async function processOfflineBuffer() {
  if (bufferDrainRunning) return;
  bufferDrainRunning = true;
  try {
    const pending = violationBuffer.getPending();
    const currentCount = pending.length;

    // Log clear state transitions for observability & viva demonstration
    if (currentCount > 0 && !wasOffline) {
      console.log(`[ViolationBuffer] ${currentCount} violation(s) waiting for delivery in the local disk buffer.`);
      wasOffline = true;
      notifyStatusChange();
    } else if (currentCount === 0 && wasOffline) {
      console.log(`[ViolationBuffer] Delivery queue cleared. No violations remain pending.`);
      wasOffline = false;
      notifyStatusChange();
    }

    if (currentCount === 0) {
      return;
    }

    console.log(`[ViolationBuffer] Attempting retry delivery for ${currentCount} buffered violation(s)...`);

    for (const item of pending) {
      let payload;
      try {
        payload = JSON.parse(item.payload_json);
      } catch (parseErr) {
        console.error(`[ViolationBuffer] Corrupted JSON in violation #${item.id}, discarding:`, parseErr);
        violationBuffer.markSent(item.id);
        continue;
      }

      if (!payload.sessionId || payload.sessionId === 'unknown-session') {
        console.log(`[ViolationBuffer] Discarding unassociated pre-session violation #${item.id}`);
        violationBuffer.markSent(item.id);
        continue;
      }

      // Strictly preserve the violation's ORIGINAL timestamp
      payload.timestamp = item.original_timestamp;
      // Older queue records have no ID; derive one from their unchanged persisted contents.
      payload.eventId ||= createHash('sha256').update(item.payload_json + '\n' + item.original_timestamp).digest('hex');
      if (item.screenshot_path) {
        payload.screenshotPath = item.screenshot_path;
      }

      try {
        const success = await sendViolationDirect(payload);
        if (success) {
          violationBuffer.markSent(item.id);
          console.log(`[ViolationBuffer] Delivered buffered violation #${item.id} (${payload.type}) [Original Time: ${item.original_timestamp}].`);
          notifyStatusChange();
        } else {
          violationBuffer.incrementAttempt(item.id);
          break; // Stop loop until next interval to avoid aggressive spamming
        }
      } catch (sendErr) {
        console.warn(`[ViolationBuffer] Retry failed for #${item.id} (${sendErr.code || sendErr.message}). Attempts: ${item.attempts + 1}.`);
        violationBuffer.incrementAttempt(item.id);
        break; // Network still unavailable, pause until next retry cycle
      }
    }
  } catch (err) {
    console.error(`[ViolationBuffer] Error processing buffer retry pass:`, err);
  } finally { bufferDrainRunning = false; }
}

// Function purpose: Notifies the renderer when the offline delivery status changes.
function notifyStatusChange() {
  if (statusChangeCallback) {
    try {
      const status = violationBuffer.getBufferStatus();
      statusChangeCallback(status);
    } catch (e) { }
  }
}

/**
 * Starts the background retry loop that periodically flushes buffered events.
 *
 * @param {number} intervalMs - Interval in milliseconds (default 12s)
 * @param {Function|null} onStatus - Optional callback on buffer state change
 */
// Function purpose: Starts periodic retries for violations saved during connection failures.
function startBufferRetryLoop(intervalMs = 12000, onStatus = null) {
  if (onStatus) {
    statusChangeCallback = onStatus;
  }
  if (retryIntervalTimer) {
    clearInterval(retryIntervalTimer);
  }

  // Run initial pass immediately
  processOfflineBuffer();

  retryIntervalTimer = setInterval(/* Function purpose: Runs the periodic check or screen update at the configured interval. */ () => {
    processOfflineBuffer();
  }, intervalMs);

  console.log(`[ViolationBuffer] Background offline retry loop started (interval: ${intervalMs / 1000}s).`);
}

// Function purpose: Stops the background violation retry timer.
function stopBufferRetryLoop() {
  if (retryIntervalTimer) {
    clearInterval(retryIntervalTimer);
    retryIntervalTimer = null;
    console.log(`[ViolationBuffer] Background retry loop stopped.`);
  }
}

// Function purpose: Requests termination of the specified application.
async function killApp(name) {
  try {
    const response = await axios.post(`${getPythonUrl()}/kill-app`, { name }, {
      timeout: 3000,
      proxy: false,
      headers: getLocalIpcHeaders()
    });
    return response.data;
  } catch (error) {
    console.error(`[PythonBridge] Error killing app ${name}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  setPythonPort,
  getPythonUrl,
  getLastPythonHealthError: /* Function purpose: Returns the last recorded Python health-check failure for diagnostics. */ () => lastHealthError,
  checkPythonHealth,
  forwardViolationToServer,
  sendViolationDirect,
  processOfflineBuffer,
  startBufferRetryLoop,
  stopBufferRetryLoop,
  killApp,
  setExamActive,
  getExamActive,
  setSessionToken,
  getSessionToken,
  setLocalIpcSecret,
  getLocalIpcHeaders,
  setAllowedEvidenceRoots,
  isPathWithinRoot
};
