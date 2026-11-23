/**
 * Standalone Fake Lock Server for Testing Screen Lock (Socket.io)
 *
 * Runs on port 5000 (default SERVER_URL) and accepts Socket.io connections
 * from the Candidate Electron App. Allows testing teacher lock:enable and
 * lock:disable events via interactive terminal keypresses without needing
 * Person B's backend server.
 *
 * Usage:
 *   node scripts/fake_lock_server.js
 */

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

// Resolve socket.io Server from server dependencies or candidate-app dependencies
let Server;
try {
  Server = require(path.join(__dirname, '..', 'server', 'node_modules', 'socket.io')).Server;
} catch (e) {
  try {
    Server = require('socket.io').Server;
  } catch (e2) {
    console.error('Could not load socket.io module:', e2.message);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 5000;
const server = http.createServer((req, res) => {
  // Simple HTTP fallback responses
  if (req.method === 'POST' && req.url === '/violation') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      console.log('\n[Fake Server] Received HTTP violation:');
      try {
        console.log(JSON.stringify(JSON.parse(body), null, 2));
      } catch (err) {
        console.log(body);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Fake Lock Server is running.');
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Test configuration
const TEST_EXAM_ID = 'CS401-MID';
const TEST_EXIT_CODE = 'exit123';
const TEST_EXIT_CODE_HASH = crypto.createHash('sha256').update(TEST_EXIT_CODE).digest('hex');

let currentLockState = {
  locked: false,
  examId: TEST_EXAM_ID,
  endTime: null,
  exitCodeHash: TEST_EXIT_CODE_HASH
};

let connectedClients = new Set();

io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  console.log(`\n[Fake Server] Candidate connected! (ID: ${socket.id}, Total connected: ${connectedClients.size})`);

  socket.on('candidate:join', (data) => {
    console.log('[Fake Server] candidate:join received:', data);
  });

  socket.on('lock:request-state', (data) => {
    console.log('[Fake Server] lock:request-state received from candidate:', data);
    if (currentLockState.locked) {
      console.log('[Fake Server] Sending active lock state to candidate...');
      socket.emit('lock:enable', currentLockState);
    }
  });

  socket.on('disconnect', (reason) => {
    connectedClients.delete(socket.id);
    console.log(`\n[Fake Server] Candidate disconnected (ID: ${socket.id}, Reason: ${reason})`);
  });
});

function emitLockEnable(durationMinutes = 30) {
  const endTime = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  currentLockState = {
    locked: true,
    examId: TEST_EXAM_ID,
    endTime: endTime,
    exitCodeHash: TEST_EXIT_CODE_HASH
  };

  console.log('\n========================================================');
  console.log('>>> EMITTING "lock:enable" TO ALL CANDIDATES <<<');
  console.log('Exam ID:        ', currentLockState.examId);
  console.log('End Time:       ', currentLockState.endTime, `(${durationMinutes} mins from now)`);
  console.log('Invigilator Code:', TEST_EXIT_CODE);
  console.log('Exit Code Hash: ', currentLockState.exitCodeHash);
  console.log('========================================================\n');

  io.emit('lock:enable', currentLockState);
}

function emitLockDisable() {
  currentLockState.locked = false;
  currentLockState.endTime = null;

  console.log('\n========================================================');
  console.log('>>> EMITTING "lock:disable" TO ALL CANDIDATES <<<');
  console.log('========================================================\n');

  io.emit('lock:disable');
}

server.listen(PORT, () => {
  console.clear();
  console.log('========================================================');
  console.log(`  IntegrityFlow — Fake Lock Server running on port ${PORT}`);
  console.log('========================================================');
  console.log(`Test Invigilator Exit Code: "${TEST_EXIT_CODE}"`);
  console.log(`Test SHA-256 Hash:        ${TEST_EXIT_CODE_HASH}`);
  console.log('');
  console.log('Interactive controls:');
  console.log('  Press [1] or [e] -> Emit "lock:enable" (exam locked for 30 min)');
  console.log('  Press [2] or [s] -> Emit "lock:enable" with short timer (15 sec test)');
  console.log('  Press [3] or [d] -> Emit "lock:disable" (unlock screen)');
  console.log('  Press [q]        -> Quit fake server');
  console.log('========================================================\n');
  console.log('Waiting for candidate Electron app to connect...\n');
});

// Configure readline for single keypress handling
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

process.stdin.on('keypress', (str, key) => {
  if (key.ctrl && key.name === 'c') {
    process.exit(0);
  }

  const k = (str || key.name || '').toLowerCase();
  if (k === '1' || k === 'e') {
    emitLockEnable(30);
  } else if (k === '2' || k === 's') {
    emitLockEnable(0.25); // 15 seconds
  } else if (k === '3' || k === 'd') {
    emitLockDisable();
  } else if (k === 'q') {
    console.log('\nExiting fake lock server.');
    process.exit(0);
  }
});
