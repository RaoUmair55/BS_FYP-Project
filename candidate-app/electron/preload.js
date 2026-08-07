const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  sendTestViolation: (payload) => ipcRenderer.send('test-violation', payload),
  onPythonCrash: (callback) => ipcRenderer.on('python-crashed', (_event, value) => callback(value)),
  checkApps: async () => ipcRenderer.invoke('check-apps'),
  startExamMode: async () => ipcRenderer.invoke('start-exam-mode')
});
