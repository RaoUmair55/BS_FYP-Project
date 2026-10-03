const path = require('path');
const fs = require('fs');

function getPythonExecutable() {
  if (process.env.PYTHON_PATH) {
    const configured = process.env.PYTHON_PATH;
    if ((path.isAbsolute(configured) || configured.includes(path.sep)) && !fs.existsSync(configured)) {
      throw new Error(`Configured PYTHON_PATH does not exist: ${configured}. Update candidate-app/.env or remove PYTHON_PATH to use the local virtual environment.`);
    }
    return configured;
  }

  // Automatically check for local virtual environment folders (venv or .venv)
  const aiDir = path.join(__dirname, '..', '..', 'ai-module');
  const candidateDir = path.join(__dirname, '..', '..');
  
  const venvCandidates = [
    path.join(aiDir, 'venv', 'Scripts', 'python.exe'),
    path.join(aiDir, '.venv', 'Scripts', 'python.exe'),
    path.join(candidateDir, 'venv', 'Scripts', 'python.exe'),
    path.join(candidateDir, '.venv', 'Scripts', 'python.exe'),
    path.join(aiDir, 'venv', 'bin', 'python'),
    path.join(aiDir, '.venv', 'bin', 'python'),
    path.join(candidateDir, 'venv', 'bin', 'python'),
    path.join(candidateDir, '.venv', 'bin', 'python')
  ];

  for (const venvExe of venvCandidates) {
    if (fs.existsSync(venvExe)) {
      console.log(`[Electron] Auto-detected Python virtual environment at: ${venvExe}`);
      return venvExe;
    }
  }

  // Default to system python on PATH
  return 'python';
}

module.exports = { getPythonExecutable };
