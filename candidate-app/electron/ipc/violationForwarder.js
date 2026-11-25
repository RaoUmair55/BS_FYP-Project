/*
 * IntegrityFlow file overview
 * Purpose: Local HTTP receiver for alerts produced by Python.
 * How it works: Listens on a dynamically assigned loopback port and authenticates
 * requests with a per-launch shared IPC secret when configured.
 * Rejects new alerts outside an exam but accepts previously persisted event IDs for recovery;
 * acknowledges only after durable local acceptance.
 * Connection: Hands alerts to pythonBridge.js and notifies main.js about active-exam events.
 */
const express = require('express');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const path = require('path');
const { forwardViolationToServer, getExamActive } = require('./pythonBridge');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

let server;
let onLocalViolationCallback = null;
let expectedIpcSecret = null;

function isValidIpcToken(provided, expected) {
  if (!expected) return true;
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Function purpose: Registers the handler that receives monitoring events from Python.
function setViolationListener(cb) {
  onLocalViolationCallback = cb;
}

// Function purpose: Starts the local HTTP receiver for Python monitoring events.
function startReceiver(onViolationCallback, ipcSecret = null) {
  if (onViolationCallback) {
    onLocalViolationCallback = onViolationCallback;
  }
  expectedIpcSecret = typeof ipcSecret === 'string' && ipcSecret.trim() ? ipcSecret.trim() : null;
  return new Promise(/* Function purpose: Runs express as part of this callback’s processing. */ (resolve, reject) => {
    const app = express();
    app.use(express.json());

    app.use((req, res, next) => {
      const provided = req.headers['x-integrityflow-ipc-token'];
      if (!isValidIpcToken(provided, expectedIpcSecret)) {
        return res.status(401).json({ status: 'unauthorized_ipc' });
      }
      next();
    });

    app.post('/violation', /* Function purpose: Handles the /violation event and updates the associated screen or process state. */ async (req, res) => {
      const violationPayload = req.body;
      const examActive = getExamActive();
      const persistedReplay = typeof violationPayload?.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(violationPayload.eventId);
      if (!examActive && !persistedReplay) {
        console.log(`[ViolationReceiver] Pre-exam event rejected: ${violationPayload?.type}`);
        return res.status(409).json({ status: 'exam_not_active_retry_later' });
      }
      console.log('[ViolationReceiver] Received violation from Python:', violationPayload?.type);

      // Notify Electron main process listener if registered
      if (examActive && typeof onLocalViolationCallback === 'function') {
        try {
          onLocalViolationCallback(violationPayload);
        } catch (cbErr) {
          console.error('[ViolationReceiver] Error in local violation callback:', cbErr);
        }
      }

      const saved = await forwardViolationToServer(violationPayload, true);
      res.status(saved ? 202 : 503).json({ status: saved ? 'accepted' : 'failed' });
    });

    server = app.listen(0, '127.0.0.1', /* Function purpose: Handles the 127.0.0.1 event and updates the associated screen or process state. */ () => {
      const port = server.address().port;
      console.log(`[ViolationReceiver] Listening for Python violations on port ${port}`);
      resolve(port);
    });

    server.on('error', /* Function purpose: Handles the error event and updates the associated screen or process state. */ (err) => {
      console.error('[ViolationReceiver] Failed to start receiver:', err);
      reject(err);
    });
  });
}

// Function purpose: Stops the local monitoring-event receiver.
function stopReceiver() {
  if (server) {
    server.close();
    console.log('[ViolationReceiver] Receiver stopped.');
  }
}

module.exports = {
  startReceiver,
  stopReceiver,
  setViolationListener,
  isValidIpcToken
};
