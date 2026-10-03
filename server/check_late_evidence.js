// Run with npm run check:late-evidence. Real HTTP/multipart/client queue; isolated model/storage doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const Session = require('./src/models/Session');
const Violation = require('./src/models/Violation');
const Exam = require('./src/models/Exam');
const Submission = require('./src/models/Submission');
const storage = require('./src/services/storage');
const socketApi = require('./src/sockets/violationSocket');
const audit = require('./src/utils/auditLogger');
const { calculateRiskScore } = require('./src/scoring/severityEngine');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'integrityflow-late-'));
const saved = new Map();
const assets = new Map();
const socketEvents = [];
const restore = [];
function replace(obj, key, value) {
    const original = obj[key]; obj[key] = value; restore.push(() => { obj[key] = original; });
}
const connectionDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
let dbReady = 1;
Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => dbReady });
restore.push(() => connectionDescriptor ? Object.defineProperty(mongoose.connection, 'readyState', connectionDescriptor) : delete mongoose.connection.readyState);
const now = Date.now();
const sessionId = '507f1f77bcf86cd799439011';
let session = new Session({ _id: sessionId, studentId: 'TEST', examId: 'EXAM-TEST',
    startTime: new Date(now - 600000), endTime: new Date(now + 60000), status: 'active' });
let failUpload = false;
let failWrite = false;
let closeDuringUpload = false;
let dropAcknowledgement = false;
let concurrentEventId = null;
let waitingWrites = 0;
let releaseWrites;
let writesReady;
let server;
let bridge;
let buffer;

replace(Session, 'findById', async id => String(id) === sessionId ? new Session(session.toObject()) : null);
replace(Session.prototype, 'save', async () => { throw new Error('Evidence delivery must never change session status'); });
replace(Violation, 'findById', async id => saved.get(String(id)) || null);
replace(Violation.prototype, 'save', async function() {
    await this.validate();
    if (this.eventId === concurrentEventId) {
        if (++waitingWrites === 2) releaseWrites();
        await writesReady;
    }
    if (failWrite) throw new Error('Simulated database write failure');
    if (saved.has(String(this._id))) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
    saved.set(String(this._id), this);
    return this;
});
replace(Violation, 'find', query => {
    const rows = [...saved.values()].filter(v => {
        if (query.sessionId?.$in && !query.sessionId.$in.some(id => String(id) === v.sessionId)) return false;
        if (query.sessionId && !query.sessionId.$in && String(query.sessionId) !== v.sessionId) return false;
        return query.decision?.$ne === undefined || v.decision !== query.decision.$ne;
    });
    return { sort: async () => rows.sort((a,b) => b.timestamp - a.timestamp),
        then: (resolve,reject) => Promise.resolve(rows).then(resolve,reject) };
});
replace(Violation, 'findByIdAndUpdate', async (id, update) => {
    const doc = saved.get(String(id)); if (doc) doc.set(update); return doc || null;
});
replace(storage, 'save', async (bytes, filename, folder) => {
    if (failUpload) throw new Error('Simulated evidence storage failure');
    if (closeDuringUpload) { closeDuringUpload = false; session.status = 'completed'; session.endTime = new Date(now - 60000); }
    const url = `/uploads/${folder}/${filename}`;
    assets.set(url, Buffer.from(bytes)); return { path: url, url };
});
replace(storage, 'delete', async url => assets.delete(url));
for (const name of ['broadcastViolation', 'broadcastRiskScoreUpdate', 'broadcastViolationReview']) {
    replace(socketApi, name, (...args) => socketEvents.push([name, ...args]));
}
replace(audit, 'logTeacherAction', async () => {});
const violationsRouter = require('./src/routes/violations');
const examRouter = require('./src/routes/exams');
const payload = (overrides = {}) => ({ sessionId, type: 'head_turn_away', severity: 2,
    timestamp: new Date(now - 120000).toISOString(), details: {}, ...overrides });

async function post(body) {
    const res = await fetch(`${process.env.SERVER_URL}/violation`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
}
function handler(router, routePath) { return router.stack.find(l => l.route?.path === routePath).route.stack.at(-1).handle; }
async function call(fn, req) {
    let result;
    const res = { statusCode: 200, status(code) { this.statusCode=code; return this; },
        json(body) { result={status:this.statusCode,body}; return this; } };
    await fn({app:{locals:{io:{}}}, ...req}, res); return result;
}

async function main() {
    const app = express(); app.use(express.json()); app.locals.io = {};
    app.use((req,res,next) => {
        if (dropAcknowledgement) {
            dropAcknowledgement = false;
            res.json = () => { req.socket.destroy(); return res; };
        }
        next();
    });
    app.use(violationsRouter);
    server = http.createServer(app);
    await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    process.env.SERVER_URL = `http://127.0.0.1:${server.address().port}`;
    const load = Module._load;
    Module._load = function(name,...args) {
        if (name === 'electron') return { app: { getPath: () => temp } };
        if (name === 'better-sqlite3') throw new Error('Use isolated JSON buffer');
        return load.call(this,name,...args);
    };
    try {
        bridge = require('../candidate-app/electron/ipc/pythonBridge');
        buffer = require('../candidate-app/electron/ipc/violationBuffer');
    } finally { Module._load=load; }
    bridge.setExamActive(true);

    // Normal delivery retains ordinary scoring and live broadcasts.
    const normal = payload({severity:1});
    await bridge.sendViolationDirect(normal);
    assert.equal(saved.size,1);
    assert.equal([...saved.values()][0].receivedLate,false);
    assert.equal(socketEvents.filter(e=>e[0]==='broadcastViolation').length,1);
    const normalScore=(await calculateRiskScore(sessionId)).riskScore;
    assert(normalScore>0);
    socketEvents.length=0;

    // Real multipart evidence survives an outage, completion, and the post-exam retry.
    const screenshot=path.join(temp,'snapshot.jpg'); const audio=path.join(temp,'clip.wav');
    fs.writeFileSync(screenshot,Buffer.from('isolated screenshot bytes'));
    fs.writeFileSync(audio,Buffer.from('isolated audio bytes'));
    const late=payload({type:'second_voice_detected',severity:5,screenshotPath:screenshot,audioPath:audio});
    dbReady=0;
    assert.equal(await bridge.forwardViolationToServer(late),true);
    assert.equal(buffer.getBufferStatus().pendingCount,1);
    const persisted=JSON.parse(buffer.getPending()[0].payload_json);
    assert.equal(persisted.eventId,late.eventId);
    session.status='completed';session.endTime=new Date(now-60000);
    bridge.setExamActive(false);dbReady=1;
    await bridge.processOfflineBuffer();
    assert.equal(buffer.getBufferStatus().pendingCount,0);
    const lateDoc=[...saved.values()].find(v=>v.eventId===late.eventId);
    assert(lateDoc.receivedLate);assert.equal(lateDoc.timestamp.toISOString(),late.timestamp);
    assert(lateDoc.receivedAt>lateDoc.timestamp);
    assert.deepEqual(assets.get(lateDoc.screenshotPath),fs.readFileSync(screenshot));
    assert.deepEqual(assets.get(lateDoc.audioPath),fs.readFileSync(audio));
    assert.equal(socketEvents.length,0,'Late evidence must not pollute live events or auto-update scores');
    assert.equal(session.status,'completed');
    assert.equal((await calculateRiskScore(sessionId)).riskScore,normalScore);
    assert.equal((await calculateRiskScore(sessionId)).violationCount,2);
    console.log('PASS: offline multipart evidence survives completion, preserves capture time, and does not silently change scoring');

    // Duplicate requests preserve reviewed state and do not upload evidence again.
    let count=saved.size;let assetCount=assets.size;
    await bridge.sendViolationDirect(late);
    assert.equal(saved.size,count);assert.equal(assets.size,assetCount);
    const conflict=await post({...late,eventId:late.eventId,severity:1});
    assert.equal(conflict.status,400);
    assert.equal((await post({...late,details:{reason:'changed under the same ID'}})).status,400);
    dropAcknowledgement=true;
    const lostAck=payload({eventId:randomUUID(),severity:3});
    bridge.setExamActive(true);
    await bridge.forwardViolationToServer(lostAck);
    assert.equal(saved.size,count+1);assert.equal(buffer.getBufferStatus().pendingCount,1);
    bridge.setExamActive(false);await bridge.processOfflineBuffer();
    assert.equal(saved.size,count+1);assert.equal(buffer.getBufferStatus().pendingCount,0);
    const raced=payload({eventId:randomUUID()});
    const concurrent=await Promise.all([post(raced),post(raced)]);
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201]);
    assert.equal(concurrent[0].body._id,concurrent[1].body._id);
    // Force both multipart uploads past the initial lookup to exercise the unique-key race/cleanup.
    concurrentEventId=randomUUID();waitingWrites=0;writesReady=new Promise(resolve=>{releaseWrites=resolve;});
    count=saved.size;assetCount=assets.size;
    const mediaRace=payload({eventId:concurrentEventId,screenshotPath:screenshot,audioPath:audio});
    await Promise.all([bridge.sendViolationDirect(mediaRace),bridge.sendViolationDirect(mediaRace)]);
    concurrentEventId=null;
    assert.equal(saved.size,count+1);assert.equal(assets.size,assetCount+2,'Losing retry must clean up its uploaded files');
    concurrentEventId=randomUUID();waitingWrites=0;writesReady=new Promise(resolve=>{releaseWrites=resolve;});
    const conflictRace=await Promise.all([
        post(payload({eventId:concurrentEventId,details:{reason:'first'}})),
        post(payload({eventId:concurrentEventId,details:{reason:'second'}}))
    ]);
    concurrentEventId=null;
    assert.deepEqual(conflictRace.map(r=>r.status).sort(),[201,400]);
    console.log('PASS: lost acknowledgements and concurrent retries store each event once');

    // Legacy clients and persisted queue records still deduplicate.
    const legacy=payload({details:{reason:'legacy',duration:2},severity:4});
    const first=await post(legacy);
    const repeated=await post({...legacy,details:JSON.stringify({duration:2,reason:'legacy'})});
    assert.equal(first.status,201);assert.equal(repeated.status,200);
    assert.equal(first.body._id,repeated.body._id);
    const oldQueued=payload({type:'no_face_detected',severity:4});
    buffer.enqueue(oldQueued);dbReady=0;await bridge.processOfflineBuffer();dbReady=1;
    await bridge.processOfflineBuffer();assert.equal(buffer.getBufferStatus().pendingCount,0);
    assert([...saved.values()].some(v=>v.type==='no_face_detected' && v.eventId.length===64));
    console.log('PASS: legacy JSON/multipart-compatible identities and old queue records remain deliverable');

    count=saved.size;assetCount=assets.size;
    for(const change of [
        {timestamp:undefined},{timestamp:'bad-date'}, {timestamp:new Date(now-700000).toISOString()},
        {timestamp:new Date(now-30000).toISOString()}, {timestamp:new Date(now+60000).toISOString()},
        {timestamp:'2026-02-30T12:00:00Z'}, {eventId:5}, {details:'invalid-json'}, {severity:8}, {type:'unknown'}
    ]) assert.equal((await post(payload(change))).status,400);
    assert.equal(saved.size,count);assert.equal(assets.size,assetCount);
    for (const timestamp of [session.startTime.toISOString(),session.endTime.toISOString()]) {
        assert.equal((await post(payload({eventId:randomUUID(),timestamp}))).status,201);
    }
    session.status='terminated';
    const terminated=await post(payload({eventId:randomUUID()}));
    assert.equal(terminated.status,201);assert(terminated.body.receivedLate);assert.equal(session.status,'terminated');
    console.log('PASS: invalid/out-of-window events are rejected; valid pre-termination evidence is retained');

    // Retryable metadata/storage/database failures must not discard buffered events.
    session.status='completed';session.endTime=undefined;
    const unknownWindow=await post(payload({eventId:randomUUID()}));assert.equal(unknownWindow.status,503);
    session.endTime=new Date('invalid');
    assert.equal((await post(payload({eventId:randomUUID()}))).status,503);
    session.endTime=new Date(now-60000);bridge.setExamActive(true);
    for(const failure of ['upload','write']) {
        const event=payload({eventId:randomUUID(),screenshotPath:screenshot,audioPath:audio});
        count=saved.size;assetCount=assets.size;
        failUpload=failure==='upload';failWrite=failure==='write';
        await bridge.forwardViolationToServer(event);
        assert.equal(saved.size,count);assert.equal(assets.size,assetCount);
        assert.equal(buffer.getBufferStatus().pendingCount,1);
        failUpload=false;failWrite=false;
        await bridge.processOfflineBuffer();
        assert.equal(buffer.getBufferStatus().pendingCount,0);assert.equal(saved.size,count+1);
    }
    // The session may close while files are uploading.
    session.status='active';session.endTime=new Date(now+60000);closeDuringUpload=true;
    const closesInFlight=payload({eventId:randomUUID(),screenshotPath:screenshot});
    await bridge.sendViolationDirect(closesInFlight);
    assert([...saved.values()].find(v=>v.eventId===closesInFlight.eventId).receivedLate);
    assert.equal(session.status,'completed');
    // Lifecycle polling can lag scheduled expiry; those arrivals must still be treated as late.
    session.status='active';session.endTime=new Date(now-60000);
    const expiresBeforePoll=await post(payload({eventId:randomUUID()}));
    assert.equal(expiresBeforePoll.status,201);assert(expiresBeforePoll.body.receivedLate);
    session.status='completed';
    console.log('PASS: failed media/database writes remain retryable; completion during upload is revalidated');

    // Check the actual examiner review handler and actual summary response.
    const before=(await calculateRiskScore(sessionId)).riskScore;
    const review=handler(violationsRouter,'/violations/:violationId/review');
    let result=await call(review,{params:{violationId:String(lateDoc._id)},body:{decision:'confirmed'}});
    assert.equal(result.status,200);assert((await calculateRiskScore(sessionId)).riskScore>before);
    result=await call(review,{params:{violationId:String(lateDoc._id)},body:{decision:'dismissed'}});
    assert.equal(result.status,200);assert.equal((await calculateRiskScore(sessionId)).riskScore,before);
    replace(Exam,'findById',async()=>({_id:'507f1f77bcf86cd799439012',examCode:'EXAM-TEST'}));
    replace(Session,'find',()=>({sort:async()=>[session]}));
    replace(Submission,'findOne',async()=>null);
    const summary=await call(handler(examRouter,'/:examId/summary'),{params:{examId:'507f1f77bcf86cd799439012'}});
    assert.equal(summary.status,200);
    const pending=[...saved.values()].filter(v=>v.receivedLate && v.decision==='pending').length;
    assert.equal(summary.body.pendingLateEvidenceCount,pending);
    assert.equal(summary.body.sessions[0].pendingLateEvidenceCount,pending);
    assert.equal(summary.body.sessions[0].finalRiskScore,before);
    // Event IDs are scoped by the actual session, so another session cannot collide with its evidence.
    const otherSessionId='507f1f77bcf86cd799439013';
    const otherSession=new Session({...session.toObject(),_id:otherSessionId});
    replace(Session,'findById',async id => String(id)===otherSessionId ? otherSession : session);
    const other=await post({...raced,sessionId:otherSessionId});
    assert.equal(other.status,201);assert.notEqual(other.body._id,concurrent[0].body._id);
    console.log('PASS: only explicit confirmation scores late evidence; summary exposes pending late arrivals');
}

main().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{
    bridge?.stopBufferRetryLoop();
    if(server) await new Promise(resolve=>server.close(resolve));
    restore.reverse().forEach(fn=>fn());
    // This check owns this exact temporary directory; never remove a computed repository path.
    const resolved=path.resolve(temp);
    assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep) && path.basename(resolved).startsWith('integrityflow-late-'));
    fs.rmSync(resolved,{recursive:true,force:true});
});
