/*
 * IntegrityFlow file overview
 * Purpose: Developer checks for the pre-existing-file warning.
 * How it works: Runs the warning function with a mocked page and checks that an already reported access alert is not sent twice, unrelated answer uploads are preserved, and old answer uploads remain blocked.
 * Connection: Verifies renderer/examScreen.js without launching the Electron app.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../renderer/examScreen.js'), 'utf8');
const notice = source.slice(source.indexOf('function showPreExistingFileModal'), source.indexOf('function handleSessionTerminated'));
let submitted = 0;
const fields = {};
const context = {
  Date, console, selectedFile: { name: 'new-answer.docx' },
  lastPreExistingModalTime: 0, lastBlockedFileName: '', sessionInfo: { sessionId: 'check' },
  escapeHtml: text => text.replaceAll('<', '&lt;'),
  window: { api: { sendTestViolation: () => submitted++ } },
  document: { getElementById: id => fields[id] || null,
    createElement: () => ({ style: {} }), body: { appendChild: element => { fields[element.id] = element; } } }
};
vm.createContext(context);
vm.runInContext(notice, context);
context.showPreExistingFileModal({ fileName: 'old.docx', appName: 'winword.exe', action: 'file_access_review_required', alreadyReported: true });
assert.equal(context.selectedFile.name, 'new-answer.docx');
assert.equal(submitted, 0, 'An already reported Python alert must not be submitted again');
assert.match(fields.preExistingFileBlockedModal.innerHTML, /no application was closed/);
context.showPreExistingFileModal({ fileName: 'old-upload.docx', appName: 'File Upload' });
assert.equal(context.selectedFile, null, 'Old answer uploads must remain blocked');
assert.equal(submitted, 1);
assert.match(fields.preExistingFileBlockedModal.innerHTML, /upload was blocked/);
console.log('PASS: file review preserves unrelated answers; uploads stay restricted; no duplicate notice alerts');
