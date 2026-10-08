/*
 * IntegrityFlow file overview
 * Purpose: Bridge between the candidate screens and Electron main.js.
 * How it works: Exposes the limited window.api methods used for session information,
 * checks, consent, starting/finishing exams and monitoring notifications.
 * Connection: Renderer JavaScript calls these methods instead of accessing Node.js or Electron directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendTestViolation: /* Function purpose: Sends the test-violation request to Electron through the restricted preload bridge. */ (payload) => ipcRenderer.send('test-violation', payload),
  onPythonCrash: /* Function purpose: Registers the renderer listener for the python-crashed notification. */ (callback) => ipcRenderer.on('python-crashed', /* Function purpose: Handles the python-crashed event and updates the associated screen or process state. */ (_event, value) => callback(value)),
  detectFace: /* Function purpose: Sends the detect-face request to Electron through the restricted preload bridge. */ (image) => ipcRenderer.invoke('detect-face', image),
  captureIdentityPhoto: /* Function purpose: Sends the capture-identity-photo request to Electron through the restricted preload bridge. */ () => ipcRenderer.invoke('capture-identity-photo'),
  getMonitoringHealth: /* Function purpose: Sends the monitoring-health request to Electron through the restricted preload bridge. */ () => ipcRenderer.invoke('monitoring-health'),
  finishExam: /* Function purpose: Sends the finish-exam request to Electron through the restricted preload bridge. */ () => ipcRenderer.invoke('finish-exam'),
  checkApps: /* Function purpose: Sends the check-apps request to Electron through the restricted preload bridge. */ () => ipcRenderer.invoke('check-apps'),
  killApp: /* Function purpose: Sends the kill-app request to Electron through the restricted preload bridge. */ (name) => ipcRenderer.invoke('kill-app', name),
  login: /* Function purpose: Sends the login request to Electron through the restricted preload bridge. */ (entryData) => ipcRenderer.invoke('login', entryData),
  proceedToIdentity: /* Function purpose: Sends the proceed-to-identity request to Electron through the restricted preload bridge. */ (consentData) => ipcRenderer.invoke('proceed-to-identity', consentData),
  proceedToSelfCheck: /* Function purpose: Sends the proceed-to-self-check request to Electron through the restricted preload bridge. */ (identityData) => ipcRenderer.invoke('proceed-to-self-check', identityData),
  declineConsent: /* Function purpose: Sends the decline-consent request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('decline-consent'),
  startExamMode: /* Function purpose: Sends the start-exam-mode request to Electron through the restricted preload bridge. */ async (options) => ipcRenderer.invoke('start-exam-mode', options),
  getSessionInfo: /* Function purpose: Sends the get-session-info request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('get-session-info'),
  checkUsbDrives: /* Function purpose: Sends the check-usb-drives request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('check-usb-drives'),
  getDisplayCount: /* Function purpose: Sends the get-display-count request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('get-display-count'),
  getBufferStatus: /* Function purpose: Sends the get-buffer-status request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('get-buffer-status'),
  onBufferStatusChanged: /* Function purpose: Registers the renderer listener for the buffer-status-changed notification. */ (callback) => ipcRenderer.on('buffer-status-changed', /* Function purpose: Handles the buffer-status-changed event and updates the associated screen or process state. */ (_event, value) => callback(value)),
  setReferenceVoice: /* Function purpose: Sends the set-reference-voice request to Electron through the restricted preload bridge. */ async (audioBase64) => ipcRenderer.invoke('set-reference-voice', audioBase64),
  checkVoice: /* Function purpose: Sends the check-voice request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('check-voice'),
  clearClipboard: /* Function purpose: Sends the clear-clipboard request to Electron through the restricted preload bridge. */ async () => ipcRenderer.invoke('clear-clipboard'),
  onPreExistingFileBlocked: /* Function purpose: Registers the renderer listener for the pre-existing-file-blocked notification. */ (callback) => ipcRenderer.on('pre-existing-file-blocked', /* Function purpose: Handles the pre-existing-file-blocked event and updates the associated screen or process state. */ (_event, data) => callback(data))
});
