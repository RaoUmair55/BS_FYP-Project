const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendTestViolation: (payload) => ipcRenderer.send('test-violation', payload),
  onPythonCrash: (callback) => ipcRenderer.on('python-crashed', (_event, value) => callback(value)),
  checkApps: () => ipcRenderer.invoke('check-apps'),
  killApp: (name) => ipcRenderer.invoke('kill-app', name),
  login: (sessionData) => ipcRenderer.invoke('login', sessionData),
  startExamMode: async () => ipcRenderer.invoke('start-exam-mode'),
  getSessionInfo: async () => ipcRenderer.invoke('get-session-info')
});
