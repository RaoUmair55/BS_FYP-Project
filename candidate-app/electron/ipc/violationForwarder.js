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
      const examActive = getExamActive();
      const persistedReplay = typeof violationPayload?.eventId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(violationPayload.eventId);
      if (!examActive && !persistedReplay) {
        console.log(`[ViolationReceiver] Pre-exam event rejected: ${violationPayload?.type}`);
        return res.status(409).json({ status: 'exam_not_active_retry_later' });
      }
      console.log('[ViolationReceiver] Received violation from Python:', violationPayload);
      
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
