/*
 * IntegrityFlow file overview
 * Purpose: Pure Electron window security & anti-cheat lockdown policies.
 * How it works: Centralizes permission filtering, renderer URL allowlisting,
 * keyboard shortcut blocking, and server-confirmed exam-finish verification
 * so main.js stays concise and every rule is directly testable.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const ALLOWED_RENDERER_PERMISSIONS = new Set([
  'media',
  'camera',
  'microphone',
  'audioCapture',
  'videoCapture',
  'notifications'
]);

const ALLOWED_RENDERER_PAGES = new Set([
  'login.html',
  'splash.html',
  'consent.html',
  'identity.html',
  'selfcheck.html',
  'examscreen.html'
]);

/**
 * Checks whether a navigation/origin URL points strictly to an allowed local renderer page.
 */
function isAllowedRendererUrl(rawUrl, rendererDir) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return false;
    const baseDir = path.resolve(rendererDir);
    const targetPath = path.resolve(decodeURIComponent(
      process.platform === 'win32' && parsed.pathname.startsWith('/')
        ? parsed.pathname.slice(1)
        : parsed.pathname
    ));
    const rel = path.relative(baseDir, targetPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    if (rel.includes(path.sep)) return false;
    return ALLOWED_RENDERER_PAGES.has(rel.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Strict Electron permission allowlist — denies everything not explicitly needed
 * and only permits requests originating from local IntegrityFlow renderer files.
 */
function isAllowedPermission(permission, requestingUrl, rendererDir) {
  if (!ALLOWED_RENDERER_PERMISSIONS.has(permission)) return false;
  return isAllowedRendererUrl(requestingUrl, rendererDir);
}

/**
 * Determines whether a keyboard input event should be blocked in Electron's before-input-event hook.
 */
function shouldBlockShortcut(input, { isDevMode = false, examActive = false } = {}) {
  if (isDevMode || !input || input.type !== 'keyDown') return false;
  const key = String(input.key || '').toLowerCase();
  const ctrlOrCmd = Boolean(input.control || input.meta);
  const shift = Boolean(input.shift);
  const alt = Boolean(input.alt);

  // Always block DevTools, View Source, Reload, Print, Save, and browser history nav in non-dev builds
  if (key === 'f12' || key === 'f5') return true;
  if (ctrlOrCmd && shift && ['i', 'j', 'c', 'r'].includes(key)) return true;
  if (ctrlOrCmd && ['r', 'u', 'p', 's'].includes(key)) return true;
  if (alt && ['arrowleft', 'arrowright'].includes(key)) return true;

  // During an active exam, also block window-close / quit shortcuts
  if (examActive) {
    if (alt && key === 'f4') return true;
    if (ctrlOrCmd && ['w', 'q'].includes(key)) return true;
  }

  return false;
}

/**
 * Verifies with the central server that the candidate's session has actually been
 * completed or terminated before allowing Electron to stop Python proctoring.
 */
async function verifySessionEndedOnServer({ serverUrl, sessionId, sessionToken, fetchImpl = fetch }) {
  if (!serverUrl || !sessionId || !sessionToken) {
    return { allowed: false, reason: 'Missing session credentials to verify exam completion' };
  }
  try {
    const res = await fetchImpl(`${serverUrl}/sessions/${encodeURIComponent(sessionId)}/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      return { allowed: false, reason: `Server rejected status verification (HTTP ${res.status})` };
    }
    const data = await res.json();
    if (data?.status === 'completed' || data?.status === 'terminated') {
      return { allowed: true, status: data.status };
    }
    return { allowed: false, reason: 'Exam session is still active on the server' };
  } catch (err) {
    return { allowed: false, reason: `Could not confirm exam completion with server: ${err.message}` };
  }
}

module.exports = {
  ALLOWED_RENDERER_PERMISSIONS,
  ALLOWED_RENDERER_PAGES,
  isAllowedRendererUrl,
  isAllowedPermission,
  shouldBlockShortcut,
  verifySessionEndedOnServer
};
