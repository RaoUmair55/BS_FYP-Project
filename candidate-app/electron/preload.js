const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendTestViolation: (payload) => ipcRenderer.send('test-violation', payload),
  onPythonCrash: (callback) => ipcRenderer.on('python-crashed', (_event, value) => callback(value)),
  checkApps: () => ipcRenderer.invoke('check-apps'),
  killApp: (name) => ipcRenderer.invoke('kill-app', name),
  login: (entryData) => ipcRenderer.invoke('login', entryData),
  proceedToIdentity: (consentData) => ipcRenderer.invoke('proceed-to-identity', consentData),
  proceedToSelfCheck: (identityData) => ipcRenderer.invoke('proceed-to-self-check', identityData),
  declineConsent: async () => ipcRenderer.invoke('decline-consent'),
  startExamMode: async () => ipcRenderer.invoke('start-exam-mode'),
  getSessionInfo: async () => ipcRenderer.invoke('get-session-info'),
  checkUsbDrives: async () => ipcRenderer.invoke('check-usb-drives'),
  getDisplayCount: async () => ipcRenderer.invoke('get-display-count'),
  getBufferStatus: async () => ipcRenderer.invoke('get-buffer-status'),
  onBufferStatusChanged: (callback) => ipcRenderer.on('buffer-status-changed', (_event, value) => callback(value)),
  setReferenceVoice: async (audioBase64) => ipcRenderer.invoke('set-reference-voice', audioBase64),
  checkVoice: async () => ipcRenderer.invoke('check-voice'),
  clearClipboard: async () => ipcRenderer.invoke('clear-clipboard'),
  onPreExistingFileBlocked: (callback) => ipcRenderer.on('pre-existing-file-blocked', (_event, data) => callback(data))
});
