const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { forwardViolationToServer, getExamActive } = require('./pythonBridge');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

let server;
let onLocalViolationCallback = null;

function setViolationListener(cb) {
  onLocalViolationCallback = cb;
}

function startReceiver(onViolationCallback) {
  if (onViolationCallback) {
    onLocalViolationCallback = onViolationCallback;
  }
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    app.post('/violation', async (req, res) => {
      const violationPayload = req.body;
      if (!getExamActive()) {
        console.log(`[ViolationReceiver] Pre-exam violation dropped: ${violationPayload?.type} (Student in pre-check phase)`);
        return res.status(200).json({ status: 'ignored_pre_exam' });
      }
      console.log('[ViolationReceiver] Received violation from Python:', violationPayload);
      
      // Notify Electron main process listener if registered
      if (typeof onLocalViolationCallback === 'function') {
        try {
          onLocalViolationCallback(violationPayload);
        } catch (cbErr) {
          console.error('[ViolationReceiver] Error in local violation callback:', cbErr);
        }
      }

      const saved = await forwardViolationToServer(violationPayload);
      res.status(saved ? 202 : 503).json({ status: saved ? 'accepted' : 'failed' });
    });

    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[ViolationReceiver] Listening for Python violations on port ${port}`);
      resolve(port);
    });

    server.on('error', (err) => {
      console.error('[ViolationReceiver] Failed to start receiver:', err);
      reject(err);
    });
  });
}

function stopReceiver() {
  if (server) {
    server.close();
    console.log('[ViolationReceiver] Receiver stopped.');
  }
}

module.exports = {
  startReceiver,
  stopReceiver,
  setViolationListener
};
