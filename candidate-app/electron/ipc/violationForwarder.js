const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { forwardViolationToServer } = require('./pythonBridge');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const ELECTRON_RECEIVER_PORT = process.env.ELECTRON_RECEIVER_PORT || 8766;

let server;

function startReceiver() {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    app.post('/violation', async (req, res) => {
      const violationPayload = req.body;
      console.log('[ViolationReceiver] Received violation from Python:', violationPayload);
      
      // Immediately respond to Python so we don't block it
      res.status(202).json({ status: 'accepted', message: 'Violation received and queued for forwarding' });
      
      // Forward to backend asynchronously
      await forwardViolationToServer(violationPayload);
    });

    server = app.listen(ELECTRON_RECEIVER_PORT, () => {
      console.log(`[ViolationReceiver] Listening for Python violations on port ${ELECTRON_RECEIVER_PORT}`);
      resolve();
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
  stopReceiver
};
