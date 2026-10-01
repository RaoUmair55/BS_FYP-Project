const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const FormData = require('form-data');
const fs = require('fs');
const violationBuffer = require('./violationBuffer');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PYTHON_IPC_PORT = process.env.PYTHON_IPC_PORT || 8000;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

let retryIntervalTimer = null;
let wasOffline = false;
let statusChangeCallback = null;
let isExamActive = false;

function setExamActive(active) {
  isExamActive = Boolean(active);
  console.log(`[PythonBridge] Active exam state updated to: ${isExamActive}`);
}

function getExamActive() {
  return isExamActive;
}

async function checkPythonHealth() {
  try {
    const response = await axios.get(`http://127.0.0.1:${PYTHON_IPC_PORT}/health`, { 
      timeout: 2000,
      proxy: false
    });
    return response.status === 200;
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

  try {
    const response = await axios.post(`${SERVER_URL}/violation`, requestData, {
      timeout: 8000,
      headers: requestHeaders
    });
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    if (err.response && (err.response.status === 404 || err.response.status === 400)) {
      // Invalid/stale session on backend - treat as consumed so it doesn't poison the retry loop
      console.warn(`[PythonBridge] Server rejected invalid/stale session violation (${err.response.status}): discarding from queue.`);
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
async function forwardViolationToServer(violationPayload) {
  if (!isExamActive) {
    console.log(`[PythonBridge] Pre-exam violation ignored: ${violationPayload?.type} (Exam not started yet)`);
    return false;
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
  if (!isExamActive) {
    return;
  }
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
  }
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
    const response = await axios.post(`http://127.0.0.1:${PYTHON_IPC_PORT}/kill-app`, { name }, { timeout: 3000 });
    return response.data;
  } catch (error) {
    console.error(`[PythonBridge] Error killing app ${name}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
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
