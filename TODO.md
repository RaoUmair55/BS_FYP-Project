# IntegrityFlow — Project TODO

---

## 🔴 High Priority — Security & Anti-Cheat Hardening (Before FYP Defense)

> Come back to these systematically after UI polish & unfinished features. Examiners will ask how a student could bypass proctoring—these close the main vectors.

- [ ] **Enforce Candidate Session Bearer Auth (`requireSessionAuth`) on all candidate endpoints**
  - *Why:* `POST /sessions` already issues a `sessionToken` (`candidate_session` scope), but only `/pairing/*` currently requires it. `POST /violation` (front-camera), `POST /submissions`, `POST /sessions/:id/camera-verification`, `GET /sessions/:id/status`, `GET /exam/:id/paper`, and `/messages` accept raw `sessionId` with no auth header—allowing IDOR (reading student PII, injecting fake violations, or force-submitting another student's exam).
  - *Fix:* Send `Authorization: Bearer <sessionToken>` from `candidate-app` (`examScreen.js`, `selfCheck.js`, `pythonBridge.js`) and enforce `requireSessionAuth` on those routes on the server.

- [ ] **Lock down Electron Candidate Window (`candidate-app/electron/main.js`)**
  - *Why:* `BrowserWindow` currently has no fullscreen/kiosk lockdown, no `Menu.setApplicationMenu(null)`, no `sandbox: true`, and does not block DevTools (`Ctrl+Shift+I` / `F12`) or reload/close shortcuts. A candidate can open DevTools and call `window.api.finishExam()` to kill Python monitoring mid-exam. Also `setPermissionRequestHandler` falls through to `callback(true)` unconditionally.
  - *Fix:* Enable `sandbox: true`, remove default menu, block DevTools/reload shortcuts in `before-input-event` during active exams, gate `finish-exam` on server-confirmed submission/termination, and deny non-whitelisted permissions.

- [ ] **Tighten Process Whitelist & Authenticate Local Electron ↔ Python IPC**
  - *Why:* `candidate-app/ai-module/config/whitelist.json` currently permits `taskmgr.exe` (students can kill `python.exe`), `python.exe`, `node.exe`, `electron.exe`, and `KNOWN_BACKGROUND_SERVICES` exempts `phoneexperiencehost.exe`, `wslhost.exe`, and `docker.exe`. Local loopback servers (`violationForwarder.js`, `ai-module/server.py`) have no per-launch shared secret, `/kill-app` lacks `SAFETY_LIST` checks, `#testViolationBtn` is active in production, and `pythonBridge.js` does not enforce path containment on `screenshotPath`/`audioPath`.
  - *Fix:* Remove bypassable apps from exam allowlists (protect only exact app/Python PIDs), generate a per-launch IPC secret passed via env var, enforce `SAFETY_LIST` in `/kill-app`, hide `#testViolationBtn` outside `APP_MODE=dev`, and enforce `path.relative()` containment in `pythonBridge.js`.

- [ ] **Render Exam PDFs via `pdfjs-dist` Canvas Instead of Raw `<iframe>`**
  - *Why:* `examScreen.js` renders PDFs in a raw Chromium `<iframe>`, exposing Chromium's built-in Download & Print toolbar and isolating copy/context-menu events from the parent lockdown. (`pdfjs-dist` is already installed in `candidate-app/electron/package.json`.)
  - *Fix:* Render PDF pages to `<canvas>` with `pdfjs-dist` and keep watermark + clipboard lockdown intact.

- [ ] **Fix Server Access Control, Upload XSS, Regex Injection & Auth Hygiene**
  - *Why:*
    1. Legacy `GET /exam` (`server/src/routes/examPaper.js`) returns **all** teachers' exams without owner scoping.
    2. `POST /submissions` has no `fileFilter` and serves uploads `inline`, enabling Stored XSS if an `.html`/`.svg` file is opened by a teacher.
    3. Unescaped `new RegExp(...)` in `admin.js` (`/assets/purge-exam` accepts `.*` and could purge all exams), `exams.js`, `sessions.js`, and `violations.js`.
    4. CORS whitelists `Origin: null` alongside `credentials: true`; password-reset JWTs are reusable until expiry; `/uploads` accepts full teacher JWTs in `?token=` query strings; `AuthContext` + `api.js` have two separate 401 refresh flows with no concurrency lock.
    5. Candidate renderer (`examScreen.js`, `selfCheck.js`) injects warning/termination/DOCX text via `.innerHTML` without escaping/sanitizing.
  - *Fix:* Scope/remove legacy `GET /exam`, restrict submission MIME types + serve as `attachment` (or sanitize), escape all regex inputs, remove `Origin: null` from CORS, make password-reset tokens single-use, unify 401 refresh with a single promise lock, and escape/sanitize all `.innerHTML` sinks.

- [ ] **Enforce `autoTerminateRiskScore` & Auto-Restart / Alert on Python Sidecar Crash**
  - *Why:* `Exam.rules.autoTerminateRiskScore` is saved in MongoDB but never enforced; if the Python AI module crashes mid-exam, `examScreen.js` only logs `console.warn` without alerting the examiner.
  - *Fix:* Check `riskScore >= exam.rules.autoTerminateRiskScore` on the server (or configurable auto-action) and report/recover from unexpected Python exits in Electron.

---

## 🟡 Pending Features & Real-Device Verification

- [ ] **Google Sign-In for Examiners:** Add Google Identity Services alongside email/password login. Verify tokens on the server, safely link existing accounts without duplicates, preserve roles, and apply email-verification rules.
- [ ] **Voice Checks Reassessment:** Reassess noise rejection, missed speech, speaker comparison, recording quality, and playable evidence. Validate on real devices while preserving the dev presentation toggle and consent requirements.
- [ ] **Side-Camera Real-Phone Acceptance & Calibration:** Core part-1 implementation and automated synthetic checks are complete; run the real-phone checklist in `SIDE_CAMERA.md` over HTTPS tunnel and calibrate angle/lighting thresholds on physical devices.
