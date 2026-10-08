// Exercise the actual grouping helper without rendering or network access.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/components/PriorityQueue.jsx'), 'utf8');
const body = source.slice(source.indexOf('export function groupViolationsList'), source.indexOf('export default function PriorityQueue'));
const group = new Function(`${body.replace('export function', 'function')}; return groupViolationsList;`)();
const old = { _id: 'a', sessionId: 'session', type: 'second_voice_detected', timestamp: '2026-10-06T10:00:00Z', audioPath: '/uploads/audio_clips/old.wav', details: { audioPath: 'D:\\local.wav' } };
const latest = { ...old, _id: 'b', timestamp: '2026-10-06T10:00:30Z', audioPath: '/uploads/audio_clips/latest.wav' };
assert.equal(group([old])[0].audioPath, old.audioPath);
assert.equal(group([old, latest])[0].audioPath, latest.audioPath);
assert.equal(group([latest, old])[0].audioPath, latest.audioPath);
console.log('PASS: single and grouped voice alerts retain the latest uploaded audio URL.');
