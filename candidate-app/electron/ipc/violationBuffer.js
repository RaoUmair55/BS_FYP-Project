const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const isElectron = Boolean(process.versions && process.versions.electron);

let Database = null;
// Only attempt to load better-sqlite3 if not in mismatched Electron ABI environment
if (!isElectron) {
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.warn('[ViolationBuffer] better-sqlite3 native module not available:', e.message);
  }
}

let dbInstance = null;
let useJsonFallback = isElectron || !Database;
let jsonStorePath = null;

function getStorePath(filename) {
  try {
    const userDataDir = (app && typeof app.getPath === 'function') 
      ? app.getPath('userData') 
      : path.join(__dirname, '..', '..', 'data');
      
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    return path.join(userDataDir, filename);
  } catch (e) {
    return path.join(__dirname, '..', filename);
  }
}

function initJsonStore() {
  jsonStorePath = getStorePath('violations_offline_buffer.json');
  if (!fs.existsSync(jsonStorePath)) {
    fs.writeFileSync(jsonStorePath, JSON.stringify({ nextId: 1, violations: [] }, null, 2), 'utf-8');
  }
  console.log(`[ViolationBuffer] Disk-backed offline buffer initialized at: ${jsonStorePath}`);
}

function readJsonStore() {
  if (!jsonStorePath) initJsonStore();
  try {
    const raw = fs.readFileSync(jsonStorePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[ViolationBuffer] Error reading JSON buffer:', e);
    return { nextId: 1, violations: [] };
  }
}

function writeJsonStore(data) {
  if (!jsonStorePath) initJsonStore();
  try {
    const tempPath = `${jsonStorePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, jsonStorePath);
  } catch (e) {
    console.error('[ViolationBuffer] Error writing atomic JSON store:', e);
  }
}

function getDatabase() {
  if (useJsonFallback || !Database) {
    if (!jsonStorePath) initJsonStore();
    return null;
  }

  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getStorePath('violations_offline_buffer.db');

  try {
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');

    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload_json TEXT NOT NULL,
        screenshot_path TEXT,
        original_timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER DEFAULT 0,
        last_attempt_at TEXT
      );
    `);
    console.log(`[ViolationBuffer] Local SQLite disk buffer initialized at: ${dbPath}`);
    return dbInstance;
  } catch (err) {
    console.warn(`[ViolationBuffer] SQLite init error, falling back to disk JSON store:`, err.message);
    useJsonFallback = true;
    initJsonStore();
    return null;
  }
}

/**
 * Enqueues a failed or offline violation into the disk-backed buffer.
 * Preserves the violation's ORIGINAL timestamp from the payload.
 *
 * @param {Object} violationPayload - The full violation payload
 * @param {string|null} screenshotPath - Path to local evidence screenshot
 * @returns {number} Inserted row ID
 */
function enqueue(violationPayload, screenshotPath = null) {
  const originalTimestamp = violationPayload.timestamp || new Date().toISOString();
  const createdAt = new Date().toISOString();
  const resolvedScreenshot = screenshotPath || violationPayload.screenshotPath || null;
  const payloadJson = JSON.stringify(violationPayload);

  const db = getDatabase();
  if (db && !useJsonFallback) {
    try {
      const stmt = db.prepare(`
        INSERT INTO violations (payload_json, screenshot_path, original_timestamp, created_at, attempts)
        VALUES (?, ?, ?, ?, 0)
      `);
      const info = stmt.run(payloadJson, resolvedScreenshot, originalTimestamp, createdAt);
      console.log(`[ViolationBuffer] Enqueued violation #${info.lastInsertRowid} (${violationPayload.type}) for offline retry.`);
      return info.lastInsertRowid;
    } catch (err) {
      console.warn('[ViolationBuffer] SQLite enqueue failed, falling back to JSON store:', err.message);
      useJsonFallback = true;
      initJsonStore();
    }
  }

  // Disk-backed JSON store
  const store = readJsonStore();
  const id = store.nextId++;
  store.violations.push({
    id,
    payload_json: payloadJson,
    screenshot_path: resolvedScreenshot,
    original_timestamp: originalTimestamp,
    created_at: createdAt,
    attempts: 0,
    last_attempt_at: null
  });
  writeJsonStore(store);
  console.log(`[ViolationBuffer] Enqueued violation #${id} (${violationPayload.type}) into disk buffer for offline retry.`);
  return id;
}

/**
 * Returns all pending buffered violations ordered oldest first (FIFO).
 *
 * @returns {Array<Object>} Pending violation rows
 */
function getPending() {
  const db = getDatabase();
  if (db && !useJsonFallback) {
    try {
      const stmt = db.prepare(`
        SELECT id, payload_json, screenshot_path, original_timestamp, created_at, attempts, last_attempt_at
        FROM violations
        ORDER BY id ASC
      `);
      return stmt.all();
    } catch (err) {
      console.warn('[ViolationBuffer] SQLite getPending failed, falling back to JSON store:', err.message);
      useJsonFallback = true;
      initJsonStore();
    }
  }

  const store = readJsonStore();
  return store.violations || [];
}

/**
 * Removes a successfully delivered violation from the buffer.
 *
 * @param {number} id - Violation record ID
 */
function markSent(id) {
  const db = getDatabase();
  if (db && !useJsonFallback) {
    try {
      const stmt = db.prepare(`DELETE FROM violations WHERE id = ?`);
      stmt.run(id);
      console.log(`[ViolationBuffer] Violation #${id} successfully marked as sent and removed from buffer.`);
      return;
    } catch (err) {
      console.warn('[ViolationBuffer] SQLite markSent failed, falling back to JSON store:', err.message);
      useJsonFallback = true;
      initJsonStore();
    }
  }

  const store = readJsonStore();
  store.violations = (store.violations || []).filter(v => v.id !== id);
  writeJsonStore(store);
  console.log(`[ViolationBuffer] Violation #${id} successfully marked as sent and removed from disk buffer.`);
}

/**
 * Updates attempts count and last_attempt_at timestamp on retry failure.
 *
 * @param {number} id - Violation record ID
 */
function incrementAttempt(id) {
  const now = new Date().toISOString();
  const db = getDatabase();
  if (db && !useJsonFallback) {
    try {
      const stmt = db.prepare(`
        UPDATE violations
        SET attempts = attempts + 1, last_attempt_at = ?
        WHERE id = ?
      `);
      stmt.run(now, id);
      return;
    } catch (err) {
      console.warn('[ViolationBuffer] SQLite incrementAttempt failed, falling back to JSON store:', err.message);
      useJsonFallback = true;
      initJsonStore();
    }
  }

  const store = readJsonStore();
  const violation = (store.violations || []).find(v => v.id === id);
  if (violation) {
    violation.attempts = (violation.attempts || 0) + 1;
    violation.last_attempt_at = now;
    writeJsonStore(store);
  }
}

/**
 * Returns current status of the offline buffer.
 *
 * @returns {{ pendingCount: number }}
 */
function getBufferStatus() {
  const db = getDatabase();
  if (db && !useJsonFallback) {
    try {
      const stmt = db.prepare(`SELECT COUNT(*) AS count FROM violations`);
      const row = stmt.get();
      return { pendingCount: row ? row.count : 0 };
    } catch (err) {
      console.warn('[ViolationBuffer] SQLite getBufferStatus failed, falling back to JSON store:', err.message);
      useJsonFallback = true;
      initJsonStore();
    }
  }

  const store = readJsonStore();
  return { pendingCount: (store.violations || []).length };
}

module.exports = {
  getDatabase,
  enqueue,
  getPending,
  markSent,
  incrementAttempt,
  getBufferStatus
};
