const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const FormData = require('form-data');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PYTHON_IPC_PORT = process.env.PYTHON_IPC_PORT || 8000;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

async function checkPythonHealth() {
  try {
    const response = await axios.get(`http://localhost:${PYTHON_IPC_PORT}/health`, { timeout: 1000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function forwardViolationToServer(violationPayload) {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[PythonBridge] Forwarding violation to backend (attempt ${attempt}/${maxRetries}):`, violationPayload);
        
        let requestData = violationPayload;
        let requestHeaders = {};
        
        if (violationPayload.screenshotPath && fs.existsSync(violationPayload.screenshotPath)) {
          const form = new FormData();
          form.append('sessionId', violationPayload.sessionId);
          form.append('type', violationPayload.type);
          form.append('severity', violationPayload.severity);
          form.append('timestamp', violationPayload.timestamp);
          if (violationPayload.details) {
            form.append('details', JSON.stringify(violationPayload.details));
          }
          form.append('screenshot', fs.createReadStream(violationPayload.screenshotPath));
          
          requestData = form;
          requestHeaders = form.getHeaders();
        }

        const response = await axios.post(`${SERVER_URL}/violation`, requestData, { 
          timeout: 10000, 
          headers: requestHeaders 
        });
        
        console.log(`[PythonBridge] Successfully forwarded to backend. Status:`, response.status);
        return true;
    } catch (error) {
      console.error(`[PythonBridge] Failed to forward to backend on attempt ${attempt}:`, error.message);
      if (attempt < maxRetries) {
        console.log(`[PythonBridge] Waiting ${retryDelay}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        console.error(`[PythonBridge] Max retries reached. Violation forwarding failed permanently.`);
        return false;
      }
    }
  }
}

module.exports = {
  checkPythonHealth,
  forwardViolationToServer
};
