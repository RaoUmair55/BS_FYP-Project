// Run with: node check_reliability.js. No camera capture or process enforcement.
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const { spawn, spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPythonExecutable } = require('./ipc/pythonRuntime');

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrityflow-check-'));
  const occupied = [];
  let receiver;
  let backend;
  try {
    for (const port of [8000, 8766]) {
      const server = net.createServer();
      try { await listen(server, port); occupied.push(server); }
      catch (err) { if (err.code !== 'EADDRINUSE') throw err; }
    }
    let offline = true;
    let delivered = 0;
    let holdDelivery = false;
    let releaseHeld;
    backend = http.createServer((req, res) => {
      req.resume();
      if (holdDelivery) {
        releaseHeld = () => { delivered++; res.writeHead(201); res.end('{}'); };
        return;
      }
      setTimeout(() => {
        if (!offline) delivered++;
        res.writeHead(offline ? 503 : 201);
        res.end('{}');
      }, 100);
    });
    process.env.SERVER_URL = `http://127.0.0.1:${await listen(backend)}`;
    // Exercise real buffering, but keep its files in this check's temporary folder.
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'electron') return { app: { getPath: () => temp } };
      if (name === 'better-sqlite3') throw new Error('Use JSON buffer for this check');
      return load.call(this, name, ...args);
    };
    let bridge;
    try {
      bridge = require('./ipc/pythonBridge');
      receiver = require('./ipc/violationForwarder');
    } finally { Module._load = load; }
    const receiverPort = await receiver.startReceiver();
    assert(![8000, 8766].includes(receiverPort));
    assert.throws(() => bridge.getPythonUrl(), /not ready/);

    const configuredPython = process.env.PYTHON_PATH;
    process.env.PYTHON_PATH = path.join(temp, 'missing-python.exe');
    assert.throws(getPythonExecutable, /does not exist/);
    if (configuredPython === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = configuredPython;

    for (const examType of ['physical_lab', 'online']) {
      const instanceId = `check-${examType}`;
      const child = spawn(getPythonExecutable(), [path.join(__dirname, '..', 'ai-module', 'main.py')], {
        cwd: path.join(__dirname, '..', 'ai-module'), windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
          PYTHON_IPC_PORT: '0', ELECTRON_RECEIVER_PORT: String(receiverPort), AI_INSTANCE_ID: instanceId,
          EXAM_TYPE: examType, IS_SELF_CHECK: 'true', APP_MODE: 'dev',
          AI_SPOOL_DIR: path.join(temp, 'python-alerts'),
          EXAM_SESSION_ID: 'unknown-session', EXAM_RULES: '{"enforceAppWhitelist":false}' }
      });
      let output = '';
      let errors = '';
      let exited = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', err => { errors += err.message; exited = true; });
      child.on('exit', () => { exited = true; });
      try {
        let ready = false;
        const deadline = Date.now() + 80000;
        while (Date.now() < deadline && !exited) {
          const match = /^INTEGRITYFLOW_PORT=(\d+)\r?$/m.exec(output);
          if (match) {
            bridge.setPythonPort(Number(match[1]));
            ready = await bridge.checkPythonHealth(instanceId);
            if (ready) break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert(ready, `${examType} startup failed: ${bridge.getLastPythonHealthError()}\n${errors}`);
        assert(![8000, 8766].some(port => bridge.getPythonUrl().endsWith(`:${port}`)));
        assert.equal(await bridge.checkPythonHealth('wrong-instance'), false);
        const face = await fetch(`${bridge.getPythonUrl()}/detect-face`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"image":""}'
        });
        assert.equal((await face.json()).detected, false);
        console.log(`PASS: ${examType} startup, dynamic port, health identity and face endpoint`);
      } finally {
        if (!exited) {
          const stopped = new Promise(resolve => child.once('exit', resolve));
          child.kill();
          await stopped;
        }
        bridge.setPythonPort(null);
      }
    }

    bridge.setExamActive(false);
    const buffer = require('./ipc/violationBuffer');
    holdDelivery = true;
    const heldEvent = { sessionId: 'check-session', type: 'head_turn_away', severity: 2,
      timestamp: new Date().toISOString(), details: {} };
    const preExam = await fetch(`http://127.0.0.1:${receiverPort}/violation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(heldEvent)
    });
    assert.equal(preExam.status, 409, 'New pre-exam events must remain disabled');
    heldEvent.eventId = require('node:crypto').randomUUID();
    const accepted = await fetch(`http://127.0.0.1:${receiverPort}/violation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(heldEvent)
    });
    assert.equal(accepted.status, 202, 'Local acceptance must not wait for the backend');
    assert.equal(buffer.getBufferStatus().pendingCount, 1);
    assert.equal(delivered, 0);
    const handoffDeadline = Date.now() + 5000;
    while (!releaseHeld && Date.now() < handoffDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert(releaseHeld, 'Backend should start asynchronously');
    releaseHeld();
    while (buffer.getBufferStatus().pendingCount && Date.now() < handoffDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(buffer.getBufferStatus().pendingCount, 0);
    holdDelivery = false;
    delivered = 0;
    console.log('PASS: saved alerts recover during self-check and acknowledge before a slow backend responds');
    bridge.setExamActive(true);
    const payload = { sessionId: 'check-session', type: 'head_turn_away', severity: 2,
      timestamp: new Date().toISOString(), details: {} };
    assert.equal(await bridge.forwardViolationToServer(payload), true);
    assert.equal(buffer.getBufferStatus().pendingCount, 1);
    bridge.setExamActive(false);
    offline = false;
    await Promise.all([bridge.processOfflineBuffer(), bridge.processOfflineBuffer()]);
    assert.equal(buffer.getBufferStatus().pendingCount, 0);
    assert.equal(delivered, 1);
    console.log('PASS: offline persistence, post-exam retry and non-overlapping delivery');
    const detection = spawnSync(getPythonExecutable(), [path.join(__dirname, '..', 'ai-module', 'check_detection.py')], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true, stdio: 'inherit', timeout: 120000
    });
    if (detection.error) throw detection.error;
    assert.equal(detection.status, 0, 'Detection regression checks failed');
  } finally {
    if (receiver) receiver.stopReceiver();
    if (backend) await new Promise(resolve => backend.close(resolve));
    for (const server of occupied) await new Promise(resolve => server.close(resolve));
    // Delete only this check's own mkdtemp folder, never application evidence.
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert(path.basename(temp).startsWith('integrityflow-check-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
