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
function setPythonPort(port) {
  pythonPort = port;
  lastHealthError = '';
}
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

function setExamActive(active) {
  isExamActive = Boolean(active);
  console.log(`[PythonBridge] Active exam state updated to: ${isExamActive}`);
}

function getExamActive() {
  return isExamActive;
}

async function checkPythonHealth(instanceId) {
  try {
    const response = await axios.get(`${getPythonUrl()}/health`, {
      timeout: 2000,
      proxy: false
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
 * Preserves the exact original timestamp in the payload.
 *
 * @param {Object} violationPayload
 * @returns {Promise<boolean>}
 */
async function sendViolationDirect(violationPayload) {
  // Assign once before delivery so buffering preserves the same event on a lost acknowledgement.
  violationPayload.eventId ||= randomUUID();
  violationPayload.timestamp ||= new Date().toISOString();
  let requestData = violationPayload;
  let requestHeaders = {};

  const screenshot = violationPayload.screenshotPath;
  const audio = violationPayload.audioPath || violationPayload.details?.audioPath;

  const screenshotRoot = path.resolve(__dirname, '..', '..', 'ai-module', 'screenshots');
  const audioRoot = path.resolve(__dirname, '..', '..', 'ai-module', 'audio_evidence');

  const resolvedScreenshot = typeof screenshot === 'string' ? path.resolve(screenshot) : '';
  const resolvedAudio = typeof audio === 'string' ? path.resolve(audio) : '';

  const hasValidScreenshot = resolvedScreenshot && fs.existsSync(resolvedScreenshot);
  const hasValidAudio = resolvedAudio && fs.existsSync(resolvedAudio);

  if (hasValidScreenshot || hasValidAudio) {
    const form = new FormData();
    form.append('sessionId', violationPayload.sessionId);
    form.append('eventId', violationPayload.eventId);
    form.append('type', violationPayload.type);
    form.append('severity', String(violationPayload.severity));
    form.append('timestamp', violationPayload.timestamp || new Date().toISOString());
    if (violationPayload.details) {
      form.append('details', typeof violationPayload.details === 'string' ? violationPayload.details : JSON.stringify(violationPayload.details));
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

  const deliveryStarted = Date.now();
  try {
    const response = await axios.post(`${SERVER_URL}/violation`, requestData, {
      timeout: 8000,
      headers: requestHeaders
    });
    console.log(`[Alert Delivery] ${violationPayload.type}: server accepted after ${Date.now() - deliveryStarted}ms; event age ${Date.now() - Date.parse(violationPayload.timestamp)}ms`);
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    if (err.response && (err.response.status === 404 || err.response.status === 400)) {
      // Invalid/stale session on backend - treat as consumed so it doesn't poison the retry loop
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
async function forwardViolationToServer(violationPayload, durableFirst = false) {
  if (!isExamActive && !durableFirst) {
    console.log(`[PythonBridge] Pre-exam violation ignored: ${violationPayload?.type} (Exam not started yet)`);
    return false;
  }

  if (durableFirst) {
    try {
      violationPayload.eventId ||= randomUUID();
      violationPayload.timestamp ||= new Date().toISOString();
      violationBuffer.enqueue(violationPayload, violationPayload.screenshotPath);
      notifyStatusChange();
      setImmediate(() => processOfflineBuffer());
      return true;
    } catch (error) {
      console.error('[PythonBridge] Could not persist incoming alert:', error);
      return false;
    }
  }

  try {
    console.log(`[PythonBridge] Forwarding violation to backend:`, violationPayload);
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
async function processOfflineBuffer() {
  if (bufferDrainRunning) return;
  bufferDrainRunning = true;
  try {
    const pending = violationBuffer.getPending();
    const currentCount = pending.length;

    // Log clear state transitions for observability & viva demonstration
    if (currentCount > 0 && !wasOffline) {
      console.log(`[ViolationBuffer] Connectivity lost. ${currentCount} violation(s) waiting in local disk buffer.`);
      wasOffline = true;
      notifyStatusChange();
    } else if (currentCount === 0 && wasOffline) {
      console.log(`[ViolationBuffer] Connectivity fully restored. All buffered violations have been successfully delivered!`);
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

function notifyStatusChange() {
  if (statusChangeCallback) {
    try {
      const status = violationBuffer.getBufferStatus();
      statusChangeCallback(status);
    } catch (e) {}
  }
}

/**
 * Starts the background retry loop that periodically flushes buffered events.
 *
 * @param {number} intervalMs - Interval in milliseconds (default 12s)
 * @param {Function|null} onStatus - Optional callback on buffer state change
 */
function startBufferRetryLoop(intervalMs = 12000, onStatus = null) {
  if (onStatus) {
    statusChangeCallback = onStatus;
  }
  if (retryIntervalTimer) {
    clearInterval(retryIntervalTimer);
  }

  // Run initial pass immediately
  processOfflineBuffer();

  retryIntervalTimer = setInterval(() => {
    processOfflineBuffer();
  }, intervalMs);

  console.log(`[ViolationBuffer] Background offline retry loop started (interval: ${intervalMs / 1000}s).`);
}

function stopBufferRetryLoop() {
  if (retryIntervalTimer) {
    clearInterval(retryIntervalTimer);
    retryIntervalTimer = null;
    console.log(`[ViolationBuffer] Background retry loop stopped.`);
  }
}

async function killApp(name) {
  try {
    const response = await axios.post(`${getPythonUrl()}/kill-app`, { name }, { timeout: 3000, proxy: false });
    return response.data;
  } catch (error) {
    console.error(`[PythonBridge] Error killing app ${name}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  setPythonPort,
  getPythonUrl,
  getLastPythonHealthError: () => lastHealthError,
  checkPythonHealth,
  forwardViolationToServer,
  sendViolationDirect,
  processOfflineBuffer,
  startBufferRetryLoop,
  stopBufferRetryLoop,
  killApp,
  setExamActive,
  getExamActive
};
