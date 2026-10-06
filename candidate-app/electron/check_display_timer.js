// Verify the real timer/import without launching Electron or inspecting real displays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const bridgeImport = source.match(/const \{[^\n]+\} = require\('\.\/ipc\/pythonBridge'\);/)[0];
  const start = source.indexOf('displayCheckInterval = setInterval(async () =>');
  const end = source.indexOf('}, 4000);', start) + '}, 4000);'.length;
  let active = false, count = 1, scans = 0, alerts = 0, errors = 0, callback;
  const bridge = {
    getExamActive: () => active,
    forwardViolationToServer: async event => {
      assert.equal(event.type, 'multiple_displays_detected');
      assert.equal(event.details.totalDisplays, 2);
      alerts++;
    }
  };
  const context = vm.createContext({
    require: () => bridge, displayCheckInterval: null,
    setInterval: fn => { callback = fn; return 1; },
    getPhysicalMonitorCount: () => { scans++; if (count === -1) throw Error('test failure'); return count; },
    activeSessionInfo: { sessionId: 'test-session' }, Date,
    console: { log() {}, error: () => { errors++; } }
  });
  vm.runInContext(bridgeImport + '\n' + source.slice(start, end), context);
  await callback(); assert.equal(scans, 0, 'inactive exams skip scans');
  active = true;
  await callback(); assert.equal(alerts, 0, 'single display does not alert');
  count = 2; await callback(); assert.equal(alerts, 1);
  count = -1; await callback(); assert.equal(errors, 1, 'timer failures are handled');
  count = 1; await callback(); assert.equal(scans, 4, 'next check still runs');
  console.log('PASS: display timer imports exam state, checks active exams and handles failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
