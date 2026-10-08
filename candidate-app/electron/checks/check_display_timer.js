// Verify the real timer/import without launching Electron or inspecting real displays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(/* Function purpose: Runs the controlled test callback or simulates a dependency for this regression check. */ async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const bridgeImport = source.match(/const \{[^\n]+\} = require\('\.\/ipc\/pythonBridge'\);/)[0];
  const start = source.indexOf('displayCheckInterval = setInterval(async () =>');
  const end = source.indexOf('}, 4000);', start) + '}, 4000);'.length;
  let active = false, count = 1, scans = 0, alerts = 0, errors = 0, callback;
  const bridge = {
    getExamActive: /* Function purpose: Returns whether the candidate is currently in an active exam. */ () => active,
    forwardViolationToServer: /* Function purpose: Forwards a monitoring event to the server and preserves it for retry if delivery fails. */ async event => {
      assert.equal(event.type, 'multiple_displays_detected');
      assert.equal(event.details.totalDisplays, 2);
      alerts++;
    }
  };
  const context = vm.createContext({
    require: /* Function purpose: Provides the require test helper or stub used by this regression check. */ () => bridge, displayCheckInterval: null,
    setInterval: /* Function purpose: Provides the set interval test helper or stub used by this regression check. */ fn => { callback = fn; return 1; },
    getPhysicalMonitorCount: /* Function purpose: Counts connected physical displays for the single-display exam restriction. */ () => { scans++; if (count === -1) throw Error('test failure'); return count; },
    activeSessionInfo: { sessionId: 'test-session' }, Date,
    console: { /* Function purpose: Provides the log test helper or stub used by this regression check. */ log() {}, error: /* Function purpose: Provides the error test helper or stub used by this regression check. */ () => { errors++; } }
  });
  vm.runInContext(bridgeImport + '\n' + source.slice(start, end), context);
  await callback(); assert.equal(scans, 0, 'inactive exams skip scans');
  active = true;
  await callback(); assert.equal(alerts, 0, 'single display does not alert');
  count = 2; await callback(); assert.equal(alerts, 1);
  count = -1; await callback(); assert.equal(errors, 1, 'timer failures are handled');
  count = 1; await callback(); assert.equal(scans, 4, 'next check still runs');
  console.log('PASS: display timer imports exam state, checks active exams and handles failures');
})().catch(/* Function purpose: Handles a rejected asynchronous operation and reports or recovers from its failure. */ error => { console.error(error); process.exitCode = 1; });
