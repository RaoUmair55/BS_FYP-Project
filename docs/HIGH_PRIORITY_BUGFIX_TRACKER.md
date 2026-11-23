# High-Priority Bugfix & Dependency Tracker

> Created: 2026-11-20  
> Completed: 2026-11-20  
> Scope: Re-verification, dependency & impact analysis, systematic fixes, and regression verification for all 10 High-Priority Bugs from the senior-dev audit (+ 1 pre-existing test mock fix caught on baseline).

---

## Baseline vs. Final Verification

| Check | Baseline | Final | Notes |
|---|---|---|---|
| `npm --prefix server run check:isolation` | ✅ PASS | ✅ PASS | All 3 isolation assertions passed |
| `npm --prefix server run check:late-evidence` | ✅ PASS | ✅ PASS | All 6 late-evidence assertions passed |
| `npm --prefix server run check:side-camera` | ❌ FAIL | ✅ PASS | Fixed missing `style: {}` in `check_secondary_camera_phone.js` mock + defensive guard in `phone.js` |
| `npm --prefix dashboard run build` | ✅ PASS | ✅ PASS | Built cleanly in 5.83s, 0 errors |
| `npm --prefix candidate-app/electron run build:renderer` | — | ✅ PASS | Rebuilt `renderer/dist/examScreen.js`, `identity.js`, `login.js` in 306ms |
| `node --check candidate-app/electron/main.js` | — | ✅ PASS | Syntax check passed |

---

## Phase 1 & 2: Re-Verification, Dependency Analysis & Fixes

| # | Bug | Re-Verification | Dependency & Impact Analysis | Fix Applied | Status |
|---|---|---|---|---|---|
| **1** | **Dashboard — Live Chat `activeSessions` & "Connected Students" KPI** | **CONFIRMED** | `LiveExamChat.jsx` expects session objects `{ sessionId/_id, studentName, studentId, rollNumber }`. `Dashboard.jsx` passed `Object.values(riskScores)` (numbers) and counted `Object.keys(riskScores).length` for Connected Students. Existing `getActiveSessions()` in `services/api.js` returns full session objects. | Fetched real `activeSessions` via `getActiveSessions()` in `Dashboard.jsx` (`refreshLiveOverview` + socket refresh), displayed `activeSessions.filter(s => s.status === 'active').length` in the KPI card, and passed exam-filtered `activeSessions` objects to `<LiveExamChat />`. | ✅ Fixed & Verified |
| **2** | **Dashboard — Undefined `showAuthModal` / `setShowAuthModal`** | **CONFIRMED** | Both `Dashboard.jsx` and `ExamManager.jsx` destructure `showAuthModal` / `setShowAuthModal` from `useAuth()`, which `AuthContext.jsx` did not export. Adding state directly to `AuthContext` preserves compatibility across all consumers without breaking `AuthModal.jsx`. | Added `const [showAuthModal, setShowAuthModal] = useState(false);` to `dashboard/src/context/AuthContext.jsx` and exposed both in `AuthContext.Provider`. | ✅ Fixed & Verified |
| **3** | **Dashboard — Identity Photo `assetUrl()`, False "Photo Verified" Badge & `localStorage.getItem('token')`** | **CONFIRMED** | Tokens live strictly in memory (`getInMemoryToken()` in `AuthContext.jsx`). `EvidenceViewer` rendered raw `cameraPhotoUrl` (breaking protected `/uploads/`), hardcoded `"Verified"` regardless of `cameraVerificationStatus`, and 4 download/preview handlers read `localStorage.getItem('token')`. `AdminDashboard` lightbox used raw `previewItem.url`. | Wrapped `cameraPhotoUrl` (`EvidenceViewer.jsx`) and lightbox `previewItem.url` (`AdminDashboard.jsx`) in `assetUrl()`; drove Identity tab & header badges from `sessionData.cameraVerificationStatus` (`verified` / `rejected` / `re_verify` / `pending` / none); replaced `localStorage.getItem('token')` with `getInMemoryToken()` in `EvidenceViewer.jsx`, `AnalyticsView.jsx`, and `AssetManagerView.jsx`. | ✅ Fixed & Verified |
| **4** | **Server — Admin Stats (`highRiskSessionsCount`), `/admin/assets` Broken Fields & `query.$or` Overwrite** | **CONFIRMED** | `Session` has `startTime` (no `createdAt`, no `riskScore`). `Submission` has `sessionId` + `uploadedAt` (no `examId`/`studentName`/`rollNumber`/`submittedAt`). `AssetManagerView.jsx` depends on `{ id, assetType, title, filename, url, createdAt, examId, examTitle, candidateName, rollNumber, meta }` — contract preserved intact. | In `server/src/routes/admin.js`: computed `highRiskSessionsCount` in a single batch query using `scoringStrategy.calculateScore()`; added `escapeRegex()`; fixed `$or` overwrites with `$and` in `/admin/assets` and `/admin/audit-logs`; sorted `Session` by `startTime`; hydrated `Submission` items from `Session` map with `createdAt: sub.uploadedAt`; guarded `items.sort()` against missing timestamps. | ✅ Fixed & Verified |
| **5** | **Server — Socket Broadcasts to Candidates** | **BY DESIGN (NOT A BUG)** | Verified across `candidate-app/`: `examScreen.js` intentionally uses 3s HTTP polling for status/messages and does not listen to teacher socket events. `server/checks/check_socket_isolation.js` enforces owner/admin-only broadcasts. Changing this would break isolation tests. | **No code change.** Kept strict owner/admin socket isolation intact. | ✅ Verified (No Change) |
| **6** | **Server — 500 `CastError` on `examCode` & Broken Upsert in `examPaper.js`** | **CONFIRMED** | `requireOwnedExam` accepts `_id`, `examCode`, or `examId`, but `exams.js` called `Exam.findById()` directly (500 on `examCode`). `requireOwnedSession`/`requireOwnedViolation` skipped `ObjectId.isValid()`. `examPaper.js` used `{ examId }` + `upsert: true`. | Added `findExamByIdentifier()` + `ObjectId.isValid()` guards in `server/src/middleware/examAccess.js`; updated `GET/PATCH/DELETE /exams/:examId`, `POST /exams/:examId/paper` (`exams.js`), and `POST /exam/:examId/paper` (`examPaper.js`, removing unsafe `upsert: true`) to use `findExamByIdentifier()`. | ✅ Fixed & Verified |
| **7** | **Candidate App — Auto-Submit Infinite Retry Loop & Stuck Modal** | **CONFIRMED** | On timer `00:00` offline failure, `autoSubmitting` reset to `false` while `autoSubmitModal` remained visible and `timerInterval` kept calling `autoSubmitExam()` every 1s, blocking the Retry button. | In `candidate-app/renderer/examScreen.js`: hid `autoSubmitModal` on failure, cleared `timerInterval` on failed auto-submit so the 1s loop stops, kept `autoSubmitting` state for the manual Retry button, and rebuilt `candidate-app/renderer/dist/`. | ✅ Fixed & Verified |
| **8** | **Candidate App — `displayCheckInterval` & Display Listener Leaks** | **CONFIRMED** | `finish-exam` and `before-quit` leaked `displayCheckInterval` / screen listeners; `displayAddedListener` didn't check `getExamActive()`; `start-exam-mode` error paths left listeners active. | Added `cleanupDisplayMonitoring()` in `candidate-app/electron/main.js`, called it in `before-quit`, `finish-exam`, and `start-exam-mode` setup/error paths, and added `if (!getExamActive()) return;` inside `displayAddedListener`. | ✅ Fixed & Verified |
| **9** | **Dashboard — History ↔ Exams Tab Reuse & `AlertFeed` Quick-Review** | **CONFIRMED** | Switching History → Exams left `ExamManager`'s `activeTab` stuck on `'completed'`. `Dashboard.jsx` only checked `activeTab === 'exams'` for `selectedSummaryExamId` header/back button. `AlertFeed` skipped `setLoadedAlerts` when `onReviewViolation` wasn't passed. | Synced `ExamManager`'s `activeTab` with `historyOnly` via `useEffect`; fixed `Dashboard.jsx` summary header/back-button to work for both `exams` and `history`; updated `AlertFeed.jsx` to always update `setLoadedAlerts` when `res.ok` before invoking `onReviewViolation?.(reviewed)`. | ✅ Fixed & Verified |
| **10** | **Dashboard — Broken Print / PDF Export** | **CONFIRMED** | `ExamSummary.jsx` calls `window.print()` with `.no-print` classes, but no `@media print` rules existed and `html, body, .dashboard-outer-shell, .workspace-canvas` locked `height: 100vh; overflow: hidden;`. | Added `@media print` rules in `dashboard/src/pages/Dashboard.css` resetting layout containers to `height: auto; overflow: visible; background: #ffffff;` and hiding sidebar/header/`.no-print` elements. | ✅ Fixed & Verified |
| **Bonus** | **Server Test — `check_secondary_camera_phone.js` Mock** | **CONFIRMED** | Mock DOM element omitted `style: {}`, failing on `holdProgressBar.style.width` during `npm run check:side-camera`. | Added `style: {}` to mock element in `server/checks/check_secondary_camera_phone.js` and guarded `if (holdProgressBar.style)` in `server/public/side-camera/phone.js`. | ✅ Fixed & Verified |

---

## Files Modified

### Server
- `server/src/middleware/examAccess.js`
- `server/src/routes/admin.js`
- `server/src/routes/exams.js`
- `server/src/routes/examPaper.js`
- `server/public/side-camera/phone.js`
- `server/checks/check_secondary_camera_phone.js`

### Dashboard
- `dashboard/src/context/AuthContext.jsx`
- `dashboard/src/pages/Dashboard.jsx`
- `dashboard/src/pages/Dashboard.css`
- `dashboard/src/components/ExamManager.jsx`
- `dashboard/src/components/AlertFeed.jsx`
- `dashboard/src/components/EvidenceViewer.jsx`
- `dashboard/src/components/AdminDashboard/AdminDashboard.jsx`
- `dashboard/src/components/AdminDashboard/AnalyticsView.jsx`
- `dashboard/src/components/AdminDashboard/AssetManagerView.jsx`

### Candidate App
- `candidate-app/electron/main.js`
- `candidate-app/renderer/examScreen.js` (+ rebuilt `candidate-app/renderer/dist/*`)
