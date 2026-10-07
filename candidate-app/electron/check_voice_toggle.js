const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../renderer/selfCheck.js'), 'utf8');
const body = source.match(/function updateBeginButton\(\) \{([\s\S]*?)\n\}/)[1];
function allowed(dev, voice, camera = true) {
    const btn = {};
    new Function('btnBegin', 'cameraPassed', 'canSkipVoice', 'devVoiceEnabled', 'micPassed', 'voicePassed', 'appsPassed', 'usbPassed', 'displayPassed', body)(btn, camera, dev, voice, false, false, true, true, true);
    return !btn.disabled;
}
assert.equal(allowed(true, false), true);
assert.equal(allowed(true, true), false);
assert.equal(allowed(false, false), false);
assert.equal(allowed(true, false, false), false);
console.log('PASS: only development voice-off bypasses audio readiness; camera remains required.');
