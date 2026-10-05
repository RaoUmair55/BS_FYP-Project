/*
 * IntegrityFlow file overview
 * Purpose: Finds the Python interpreter used to start local monitoring.
 * How it works: Checks an explicit PYTHON_PATH, then local venv/.venv interpreters,
 *  then the system python command. Reports a missing configured interpreter.
 * Connection: Called by Electron main.js and the reliability checks before launching
 *  ai-module/main.py.
 */
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
