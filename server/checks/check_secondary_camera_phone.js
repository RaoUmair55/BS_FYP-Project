// Exercise the actual phone decision loop with controlled frames, motion and time; no hardware access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function main() {
    const rules = await import('../public/side-camera/rules.mjs');
    let now = 1000, brightness = 100, flat = false, live = true, pairingUrlCleared = false;
    const elements = new Map(), calls = [], posts = [], refPosts = [];
    const element = id => {
        if (!elements.has(id)) elements.set(id, { videoWidth: 640, videoHeight: 480, style: {}, addEventListener() {}, replaceChildren() {}, append() {} });
        return elements.get(id);
    };
    const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(Array.from({ length: 32 * 24 * 4 }, (_, i) => {
            if (i % 4 === 3) return 255;
            if (flat || brightness <= 20) return brightness;
            return ((i >> 2) % 2 === 0) ? Math.min(255, brightness + 35) : Math.max(0, brightness - 35);
        })) }) }),
        toDataURL: () => 'data:image/jpeg;base64,/9j/2Q==' });
    const context = vm.createContext({ ...rules, URL, Date, console, Blob, FormData, AbortSignal, atob, Uint8Array,
        crypto: require('node:crypto').webcrypto, performance: { now: () => now }, innerWidth: 400, innerHeight: 800,
        location: { href: 'https://backend.example/side-camera/?token=secret', pathname: '/side-camera/' },
        history: { replaceState: (_a, _b, url) => { pairingUrlCleared = url === '/side-camera/'; } },
        document: { getElementById: element, createElement: tag => tag === 'canvas' ? canvas() : {}, addEventListener() {} },
        window: { addEventListener() {} }, navigator: {}, sessionStorage: { setItem() {} },
        fetch: async (url, options) => {
            assert(!String(url).startsWith('data:'), 'Phone script must never fetch(data:...) because CSP connect-src self blocks it in real browsers');
            return url.includes('/pairing/reference-photo') ? (refPosts.push(options.body), { ok: true, status: 201 }) :
                (posts.push(options.body), { ok: true, status: 201 });
        },
        setInterval() {}, clearInterval() {}
    });
    const source = fs.readFileSync(path.join(__dirname, '../public/side-camera/phone.js'), 'utf8').replace(/^import .*;\r?$/gm, '');
    vm.runInContext(source, context); assert(pairingUrlCleared);
    const cleanDetections = [
        { categories: [{ categoryName: 'person', score: 0.9 }], boundingBox: { originX: 20, originY: 20, width: 200, height: 300 } },
        { categories: [{ categoryName: 'keyboard', score: 0.85 }] }
    ];
    let currentDetections = cleanDetections, aiCalls = 0;
    context.testSocket = { connected: true, emit: (name, payload, ack) => { calls.push({ name, payload }); if (ack) ack({ ok: true, verified: true }); } };
    context.testStream = { getVideoTracks: () => [{ get readyState() { return live ? 'live' : 'ended'; } }] };
    context.testDetector = { detectForVideo: () => { aiCalls++; return { detections: currentDetections }; }, close() {} };
    vm.runInContext("socket = testSocket; stream = testStream; detector = testDetector; running = true; token = 'test'; sessionId = 'test-session'; orientation = { alpha: 0, beta: 0, gamma: 0 };", context);
    const inspect = () => { vm.runInContext('orientationAt = performance.now(); inspect();', context); };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    inspect(); assert.equal(vm.runInContext('verified', context), false);
    // 1-tick AI flicker mid-hold must not wipe the 3s progress bar; recovers cleanly and verifies at 3s.
    now += 1000; inspect(); assert.equal(vm.runInContext('verified', context), false);
    currentDetections = []; now += 1000; inspect(); assert.equal(vm.runInContext('verified', context), false);
    currentDetections = cleanDetections; now += 1000; inspect();
    await tick();
    assert.equal(vm.runInContext('verified', context), true);
    assert.equal(calls.filter(c => c.name === 'placement-result' && c.payload.verified).length, 1);
    assert.equal(refPosts.length, 1, 'Clean desk baseline reference photo must upload automatically on verification');
    assert.equal(refPosts[0].get('source'), 'initial');
    // Movement duration (>3s) + 60s cooldown + obstruction (>5s) + ended track still work.
    vm.runInContext('orientation = { alpha: 11, beta: 0, gamma: 0 };', context);
    now += 1000; inspect(); now += 3000; inspect(); assert.equal(posts.length, 0);
    now += 1; inspect(); await tick();
    assert.equal(posts.length, 1); assert.equal(posts[0].get('type'), 'secondary_camera_moved');
    assert.equal(posts[0].get('source'), 'side_camera'); assert.equal(posts[0].getAll('screenshot').length, 1);
    now += 10000; inspect(); await tick(); assert.equal(posts.length, 1);
    now += 60000; inspect(); await tick(); assert.equal(posts.length, 2);
    brightness = 0; inspect(); now += 5000; inspect(); await tick(); assert.equal(posts.length, 2);
    now += 1; inspect(); await tick();
    assert.equal(posts.length, 3); assert.equal(posts[2].get('type'), 'secondary_camera_obstructed');
    now += 10000; inspect(); await tick(); assert.equal(posts.length, 3);
    brightness = 100; inspect(); live = false; now += 1000; inspect(); await tick();
    assert.equal(posts.length, 4); assert.equal(posts[3].get('type'), 'secondary_camera_obstructed');
    // Recover from ended track, then hold bright white paper directly over the lens (flat contrast, high brightness) for >5s.
    live = true; brightness = 100; flat = false;
    vm.runInContext('orientation = { alpha: 0, beta: 0, gamma: 0 };', context);
    inspect();
    brightness = 210; flat = true;
    inspect(); now += 5001; inspect(); await tick();
    assert.equal(posts.length, 5); assert.equal(posts[4].get('type'), 'secondary_camera_obstructed');
    // Part 2: lazy 2.5s on-phone AI monitoring (2-check confirmation, 60s cooldown).
    flat = false; brightness = 100;
    now += 2500; inspect(); await tick();
    const callsAfterScan = aiCalls;
    now += 1000; inspect(); assert.equal(aiCalls, callsAfterScan, 'AI scan must be throttled to >= 2500ms cadence');
    // Cell phone: 1st scan does not fire; 2nd consecutive scan fires; 3rd inside 60s cooldown is suppressed.
    currentDetections = [...cleanDetections, { categories: [{ categoryName: 'cell phone', score: 0.78 }], boundingBox: { originX: 250, originY: 280, width: 60, height: 40 } }];
    now += 2500; inspect(); await tick(); assert.equal(posts.length, 5);
    now += 2500; inspect(); await tick();
    assert.equal(posts.length, 6); assert.equal(posts[5].get('type'), 'cell_phone'); assert.equal(posts[5].get('severity'), '4');
    now += 2500; inspect(); await tick(); assert.equal(posts.length, 6, 'Cell phone cooldown must suppress duplicate within 60s');
    // Second person: 2 consecutive scans fire severity 5.
    currentDetections = [
        ...cleanDetections,
        { categories: [{ categoryName: 'person', score: 0.88 }], boundingBox: { originX: 350, originY: 30, width: 180, height: 310 } }
    ];
    now += 2500; inspect(); await tick(); assert.equal(posts.length, 6);
    now += 2500; inspect(); await tick();
    assert.equal(posts.length, 7); assert.equal(posts[6].get('type'), 'second_person_detected'); assert.equal(posts[6].get('severity'), '5');
    // Candidate absent: requires 2 consecutive 2.5s scans (~5s).
    currentDetections = [{ categories: [{ categoryName: 'keyboard', score: 0.85 }] }];
    now += 2500; inspect(); await tick();
    assert.equal(posts.length, 7);
    now += 2500; inspect(); await tick();
    assert.equal(posts.length, 8); assert.equal(posts[7].get('type'), 'no_face_detected'); assert.equal(posts[7].get('severity'), '3');
    console.log('PASS: actual phone loop verifies after 3s with flicker grace, uploads clean desk baseline without fetch(data:...), enforces movement/dark+flat-paper obstruction checks, and runs lazy 2.5s Part-2 desk AI with confirmation checks and 60s cooldowns. No real phone used.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
