// Run with: npm --prefix candidate-app/electron run check:security
// Verifies Electron window lockdown policies, server-confirmed finish-exam gate,
// and pdfjs-dist canvas rendering (no raw PDF <iframe>).
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  isAllowedRendererUrl,
  isAllowedPermission,
  shouldBlockShortcut,
  verifySessionEndedOnServer
} = require('../ipc/windowSecurity');

const rendererDir = path.resolve(__dirname, '..', '..', 'renderer');

async function main() {
  // 1. Renderer URL allowlist
  const examUrl = pathToFileURL(path.join(rendererDir, 'examScreen.html')).href;
  const loginUrl = pathToFileURL(path.join(rendererDir, 'login.html')).href;
  const outsideFileUrl = pathToFileURL(path.resolve(rendererDir, '..', 'electron', 'main.js')).href;

  assert.equal(isAllowedRendererUrl(examUrl, rendererDir), true);
  assert.equal(isAllowedRendererUrl(loginUrl, rendererDir), true);
  assert.equal(isAllowedRendererUrl('https://google.com', rendererDir), false);
  assert.equal(isAllowedRendererUrl('javascript:alert(1)', rendererDir), false);
  assert.equal(isAllowedRendererUrl(outsideFileUrl, rendererDir), false);
  console.log('PASS: renderer navigation URL allowlist blocks external and parent-directory paths');

  // 2. Permission request/check allowlist
  assert.equal(isAllowedPermission('camera', examUrl, rendererDir), true);
  assert.equal(isAllowedPermission('media', examUrl, rendererDir), true);
  assert.equal(isAllowedPermission('microphone', examUrl, rendererDir), true);
  assert.equal(isAllowedPermission('geolocation', examUrl, rendererDir), false);
  assert.equal(isAllowedPermission('openExternal', examUrl, rendererDir), false);
  assert.equal(isAllowedPermission('usb', examUrl, rendererDir), false);
  assert.equal(isAllowedPermission('camera', 'https://evil.example', rendererDir), false);
  console.log('PASS: Electron permission handler denies non-whitelisted permissions and external origins');

  // 3. Keyboard shortcut lockdown
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'F12' }, { isDevMode: false, examActive: false }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'I', control: true, shift: true }, { isDevMode: false, examActive: true }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'r', control: true }, { isDevMode: false, examActive: true }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'p', control: true }, { isDevMode: false, examActive: true }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 's', control: true }, { isDevMode: false, examActive: true }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'F4', alt: true }, { isDevMode: false, examActive: true }), true);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'F4', alt: true }, { isDevMode: false, examActive: false }), false);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'a' }, { isDevMode: false, examActive: true }), false);
  assert.equal(shouldBlockShortcut({ type: 'keyDown', key: 'F12' }, { isDevMode: true, examActive: true }), false);
  console.log('PASS: keyboard shortcut blocker prevents DevTools, reload, print, save, and mid-exam close');

  // 4. Server-confirmed finish-exam gate
  let currentStatus = 'active';
  let sawAuthHeader = null;
  const mockServer = http.createServer((req, res) => {
    sawAuthHeader = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: currentStatus }));
  });
  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${mockServer.address().port}`;
  try {
    const activeCheck = await verifySessionEndedOnServer({ serverUrl, sessionId: '507f1f77bcf86cd799439011', sessionToken: 'tok-123' });
    assert.equal(activeCheck.allowed, false, 'finish-exam must be denied while session is still active');
    assert.equal(sawAuthHeader, 'Bearer tok-123');

    currentStatus = 'completed';
    const completedCheck = await verifySessionEndedOnServer({ serverUrl, sessionId: '507f1f77bcf86cd799439011', sessionToken: 'tok-123' });
    assert.equal(completedCheck.allowed, true);

    currentStatus = 'terminated';
    const terminatedCheck = await verifySessionEndedOnServer({ serverUrl, sessionId: '507f1f77bcf86cd799439011', sessionToken: 'tok-123' });
    assert.equal(terminatedCheck.allowed, true);

    const missingCreds = await verifySessionEndedOnServer({ serverUrl, sessionId: '507f1f77bcf86cd799439011', sessionToken: null });
    assert.equal(missingCreds.allowed, false);
  } finally {
    await new Promise(resolve => mockServer.close(resolve));
  }
  console.log('PASS: finish-exam gate enforces server-confirmed completed/terminated status');

  // 5. Verify main.js lockdown settings & pdfjs-dist canvas renderer (no raw PDF <iframe>)
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSrc, /sandbox:\s*true/);
  assert.match(mainSrc, /Menu\.setApplicationMenu\(null\)/);
  assert.match(mainSrc, /setWindowOpenHandler/);
  assert.match(mainSrc, /verifySessionEndedOnServer/);

  const examSrc = fs.readFileSync(path.join(rendererDir, 'examScreen.js'), 'utf8');
  assert.ok(!examSrc.includes('<iframe'), 'examScreen.js must not render exam PDFs in a raw <iframe>');
  assert.match(examSrc, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(examSrc, /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs/);
  assert.match(examSrc, /isDevMode === true/, 'testViolationBtn must be gated to dev mode');
  console.log('PASS: main.js enables sandbox/lockdown and examScreen.js renders PDFs via pdfjs-dist canvas');

  // 6. Step 4 checks: Process whitelist hardening, IPC secret auth, and path containment
  const whitelistJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'ai-module', 'config', 'whitelist.json'), 'utf8'));
  const examWl = new Set(whitelistJson.exam_whitelist.map(x => x.toLowerCase()));
  for (const forbidden of ['taskmgr.exe', 'python.exe', 'node.exe', 'electron.exe', 'esbuild.exe']) {
    assert.equal(examWl.has(forbidden), false, `exam_whitelist must not allow ${forbidden}`);
  }

  const enforcerPy = fs.readFileSync(path.resolve(__dirname, '..', '..', 'ai-module', 'whitelist_enforcer.py'), 'utf8');
  const bgSection = enforcerPy.slice(enforcerPy.indexOf('self.KNOWN_BACKGROUND_SERVICES'), enforcerPy.indexOf('self.protected_pid'));
  for (const bypass of ['phoneexperiencehost.exe', 'wslhost.exe', 'wslservice.exe', 'docker.exe', 'dockerd.exe']) {
    assert.ok(!bgSection.toLowerCase().includes(bypass), `KNOWN_BACKGROUND_SERVICES must not exempt ${bypass}`);
  }

  const serverPy = fs.readFileSync(path.resolve(__dirname, '..', '..', 'ai-module', 'server.py'), 'utf8');
  assert.match(serverPy, /INTEGRITYFLOW_IPC_SECRET/);
  assert.match(serverPy, /x-integrityflow-ipc-token/i);
  assert.match(serverPy, /SAFETY_LIST/);

  // Exercise real violationForwarder IPC secret authentication + pythonBridge path containment
  const os = require('node:os');
  const Module = require('node:module');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrityflow-ipc-check-'));
  const origLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return { app: { getPath: () => temp } };
    if (name === 'better-sqlite3') throw new Error('Use JSON buffer');
    return origLoad.call(this, name, ...args);
  };
  let forwarder;
  let bridge;
  try {
    forwarder = require('../ipc/violationForwarder');
    bridge = require('../ipc/pythonBridge');
  } finally {
    Module._load = origLoad;
  }

  const ipcSecret = 'test-launch-ipc-secret-64-chars-0123456789abcdef0123456789abcdef';
  const recvPort = await forwarder.startReceiver(null, ipcSecret);
  try {
    const sample = { sessionId: '507f1f77bcf86cd799439011', type: 'head_turn_away', severity: 2, eventId: require('node:crypto').randomUUID() };
    const noTok = await fetch(`http://127.0.0.1:${recvPort}/violation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample)
    });
    assert.equal(noTok.status, 401, 'violationForwarder must reject missing IPC token');

    const badTok = await fetch(`http://127.0.0.1:${recvPort}/violation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IntegrityFlow-IPC-Token': 'wrong-token' }, body: JSON.stringify(sample)
    });
    assert.equal(badTok.status, 401, 'violationForwarder must reject wrong IPC token');

    const okTok = await fetch(`http://127.0.0.1:${recvPort}/violation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IntegrityFlow-IPC-Token': ipcSecret }, body: JSON.stringify(sample)
    });
    assert.equal(okTok.status, 202, 'violationForwarder must accept matching IPC token');

    // Path containment checks
    const validShot = path.join(temp, 'valid.jpg');
    const badExt = path.join(temp, 'secret.env');
    fs.writeFileSync(validShot, 'jpeg');
    fs.writeFileSync(badExt, 'SECRET=1');
    assert.equal(bridge.isPathWithinRoot(validShot, temp, new Set(['.jpg'])), true);
    assert.equal(bridge.isPathWithinRoot(badExt, temp, new Set(['.jpg'])), false);
    assert.equal(bridge.isPathWithinRoot(path.resolve(__dirname, '..', 'package.json'), temp, new Set(['.json'])), false);
  } finally {
    forwarder.stopReceiver();
    bridge.stopBufferRetryLoop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('PASS: process whitelist hardened, local IPC secret enforced, and evidence path containment verified');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
