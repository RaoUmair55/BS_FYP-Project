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

(async () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const start = main.indexOf("ipcMain.handle('proceed-to-identity'");
    assert.ok(start >= 0);
    let handler;
    const activeSessionInfo = { consentGiven: false };
    // Execute the real IPC handler without starting Electron or any monitors.
    vm.runInNewContext(main.slice(start, main.indexOf('\n});', start) + 4), {
        ipcMain: { handle: (name, fn) => { handler = fn; } },
        activeSessionInfo, mainWindow: null, console: { log() {} }, Date
    });
    for (const data of [undefined, {}, { consentGiven: false }]) {
        await assert.rejects(handler({}, data), /review and accept/);
        assert.equal(activeSessionInfo.consentGiven, false);
    }
    await handler({}, { consentGiven: true, consentTimestamp: '2026-10-03T00:00:00Z' });
    assert.equal(activeSessionInfo.consentGiven, true);

    const identity = fs.readFileSync(path.join(__dirname, '../renderer/identity.js'), 'utf8');
    for (const consentGiven of [undefined, false, true]) {
        let ready, fetchCount = 0, advanced = false;
        const elements = new Map();
        const element = id => {
            if (!elements.has(id)) elements.set(id, { value: '', style: {}, focus() {}, listeners: {},
                addEventListener(event, fn) { this.listeners[event] = fn; } });
            return elements.get(id);
        };
        vm.runInNewContext(identity, {
            document: { getElementById: element, addEventListener: (event, fn) => { ready = fn; } },
            window: { api: {
                getSessionInfo: async () => ({ consentGiven, studentName: 'Test Candidate', rollNumber: 'BSCS-01', examId: 'EXAM-A', serverUrl: 'http://check' }),
                proceedToSelfCheck: async () => { advanced = true; }
            } },
            sessionStorage: { getItem: () => '{}', setItem() {} },
            localStorage: { setItem() {} },
            fetch: async (url, options) => { fetchCount++; assert.equal(JSON.parse(options.body).consentGiven, true); return { ok: true, json: async () => ({ _id: 'check-session' }) }; },
            console: { log() {}, warn() {}, error() {} }, Date, AbortSignal
        });
        await ready();
        await element('btnSubmitIdentity').listeners.click();
        assert.equal(fetchCount, consentGiven === true ? 1 : 0);
        if (consentGiven !== true) assert.match(element('errorBanner').textContent, /consent is missing/);
        else assert.equal(advanced, true);
    }
    console.log('PASS: real IPC and identity flow reject missing consent and accept explicit consent');
})().catch(error => { console.error(error); process.exitCode = 1; });
