/*
 * IntegrityFlow file overview
 * Purpose: Developer checks for the consent and identity flow.
 * How it works: Uses assertions and a mocked renderer environment to verify consent-dependent behavior and the monitoring disclosure.
 * Connection: Run through npm run check:consent; it does not join a real exam.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(/* Function purpose: Runs the controlled test callback or simulates a dependency for this regression check. */ async () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const start = main.indexOf("ipcMain.handle('proceed-to-identity'");
    assert.ok(start >= 0);
    let handler;
    const activeSessionInfo = { consentGiven: false };
    // Execute the real IPC handler without starting Electron or any monitors.
    vm.runInNewContext(main.slice(start, main.indexOf('\n});', start) + 4), {
        ipcMain: { handle: /* Function purpose: Provides the handle test helper or stub used by this regression check. */ (name, fn) => { handler = fn; } },
        activeSessionInfo, mainWindow: null, console: { /* Function purpose: Provides the log test helper or stub used by this regression check. */ log() {} }, Date
    });
    for (const data of [undefined, {}, { consentGiven: false }]) {
        await assert.rejects(handler({}, data), /review and accept/);
        assert.equal(activeSessionInfo.consentGiven, false);
    }
    await handler({}, { consentGiven: true, consentTimestamp: '2026-10-03T00:00:00Z' });
    assert.equal(activeSessionInfo.consentGiven, true);

    const identity = fs.readFileSync(path.join(__dirname, '..', '../renderer/identity.js'), 'utf8');
    for (const consentGiven of [undefined, false, true]) {
        let ready, fetchCount = 0, advanced = false;
        const elements = new Map();
        // Function purpose: Provides the element test helper or stub used by this regression check.
        const element = id => {
            if (!elements.has(id)) elements.set(id, { value: '', style: {}, /* Function purpose: Provides the focus test helper or stub used by this regression check. */ focus() {}, listeners: {},
                // Function purpose: Provides the add event listener test helper or stub used by this regression check.
                addEventListener(event, fn) { this.listeners[event] = fn; } });
            return elements.get(id);
        };
        vm.runInNewContext(identity, {
            document: { getElementById: element, addEventListener: /* Function purpose: Provides the add event listener test helper or stub used by this regression check. */ (event, fn) => { ready = fn; } },
            window: { api: {
                getSessionInfo: /* Function purpose: Provides the get session info test helper or stub used by this regression check. */ async () => ({ consentGiven, studentName: 'Test Candidate', rollNumber: 'BSCS-01', examId: 'EXAM-A', serverUrl: 'http://check' }),
                proceedToSelfCheck: /* Function purpose: Provides the proceed to self check test helper or stub used by this regression check. */ async () => { advanced = true; }
            } },
            sessionStorage: { getItem: /* Function purpose: Provides the get item test helper or stub used by this regression check. */ () => '{}', /* Function purpose: Provides the set item test helper or stub used by this regression check. */ setItem() {} },
            localStorage: { /* Function purpose: Provides the set item test helper or stub used by this regression check. */ setItem() {} },
            fetch: /* Function purpose: Provides the fetch test helper or stub used by this regression check. */ async (url, options) => { fetchCount++; assert.equal(JSON.parse(options.body).consentGiven, true); return { ok: true, json: /* Function purpose: Provides the json test helper or stub used by this regression check. */ async () => ({ _id: 'check-session' }) }; },
            console: { /* Function purpose: Provides the log test helper or stub used by this regression check. */ log() {}, /* Function purpose: Provides the warn test helper or stub used by this regression check. */ warn() {}, /* Function purpose: Provides the error test helper or stub used by this regression check. */ error() {} }, Date, AbortSignal
        });
        await ready();
        await element('btnSubmitIdentity').listeners.click();
        assert.equal(fetchCount, consentGiven === true ? 1 : 0);
        if (consentGiven !== true) assert.match(element('errorBanner').textContent, /consent is missing/);
        else assert.equal(advanced, true);
    }
    console.log('PASS: real IPC and identity flow reject missing consent and accept explicit consent');
})().catch(/* Function purpose: Handles a rejected asynchronous operation and reports or recovers from its failure. */ error => { console.error(error); process.exitCode = 1; });
