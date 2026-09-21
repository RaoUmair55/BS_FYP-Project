# IntegrityFlow Dashboard Documentation

## Project Context: What Are We Building & How?
**What we are building:** We are building the examiner dashboard for **IntegrityFlow**, an AI-powered exam proctoring system. This dashboard acts as the central command center for human examiners. It allows teachers to create and manage exam codes, upload question papers, monitor active candidate sessions in real-time, view automated risk scores for each student, review captured evidence of potential violations, triage/review violation alerts with decision controls, and **review historical exam analytics & candidate performance rosters after an exam completes**.

**How we are building it:** The dashboard is built using **React** (bootstrapped via **Vite**) with a **Material Design** visual system. It connects to our Node.js backend using:
1. **Axios & Fetch (REST API)**: For teacher authentication, exam creation, candidate session queries, status lifecycle updates, violation review triage (`PATCH /violations/:violationId/review`), ending exam sessions (`PATCH /exams/:examId/status`), fetching historical exam summaries (`GET /exams/:examId/summary`), and fetching screenshot evidence.
2. **Socket.io (WebSockets)**: For persistent connection to receive instant alert feeds when a violation occurs and live multi-client broadcast of violation review decisions (`violationReviewed`).

---

## High-Priority Examiner Improvements Status Summary

| Module Improvement | Scope | Status |
| :--- | :--- | :--- |
| **1. Exam Creation & Code System** | Backend `Exam` model, `POST /exams` paper upload, custom/auto code generation, candidate app code validation. | **COMPLETE** ✅ |
| **2. Violation Review & Triage Workflow** | Backend `PATCH /violations/:violationId/review`, Socket.io `violationReviewed` broadcast, AlertFeed quick confirm/dismiss, notes modal, unreviewed badges. | **COMPLETE** ✅ |
| **3. Historical Exam View & Analytics Summary** | Backend `GET /exams?status=completed` filter, `GET /exams/:examId/summary` analytics aggregator, ExamManager tabs, End Exam confirmation dialog, ExamSummary stat cards & candidate roster. | **COMPLETE** ✅ |
| **4. Secure In-Memory Auth & Full Examiner Auth UI Flow** | `AuthContext` with strict in-memory tokens & silent refresh on mount, Axios 401 retry interceptor, Material `Login`, `Signup`, `ForgotPassword`, `ResetPassword`, and App route protection. | **COMPLETE** ✅ |
| **5. Candidate Identity & Real Student Names** | Dashboard `StudentList` displays `studentName` (primary) and `rollNumber` (secondary), `EvidenceViewer` header displays `Viewing: [Student Name] ([Roll Number])`, `ExamSummary` candidate roster and CSV export include real student names. | **COMPLETE** ✅ |

---

## Design System (Material Design Direction)

The dashboard enforces a clean, accessible **Material Design** visual direction:

* **Typography**:
  - Primary Font: Google Fonts **Roboto** (`'Roboto', sans-serif`), offering high legibility across screens.
  - Scale:
    - Page Titles: `24px` Medium (500)
    - Card Headers / Section Titles: `18px` Medium (500)
    - Card Subtitles / Badges: `13px` – `14px` Regular (400) / Medium (500)
    - Monospace Metadata: `Roboto Mono` for technical IDs and exam codes.

* **Color Palette**:
  - **Brand Primary Blue**: `#1A73E8` (Google Material Blue) used for primary action buttons, active navigation tabs, active state highlights, and unreviewed violation card borders.
  - **Primary Hover**: `#1557B0`
  - **Surface Neutral Background**: `#F8F9FA` (Clean gray-white)
  - **Card Surface Background**: `#FFFFFF`
  - **Borders & Dividers**: `#DADCE0` / `#E8EAED`
  - **Text Primary**: `#202124`
  - **Text Secondary**: `#5F6368`
  - **Functional Status Colors**:
    - **Live Active Exam**: `#188038` (Glowing pulse dot, `#E6F4EA` background)
    - **Completed Exam**: `#5F6368` (Settled muted gray background)
    - **Confirmed Violation**: `#D93025` (Material Red badge, background `#FCE8E6`)
    - **Dismissed Violation**: `#5F6368` (Muted Gray badge, background `#F1F3F4`)
    - **Pending Review**: `#1A73E8` (Primary Blue badge, background `#E8F0FE`)

* **Elevation & Depth**:
  - Material card surface shadow: `box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)`
  - Card hover shadow: `box-shadow: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)`
  - Modal overlay elevation: `box-shadow: 0 4px 8px 3px rgba(60,64,67,0.15), 0 1px 3px 0 rgba(60,64,67,0.3)`

* **Buttons & Card Geometry**:
  - Standard `8px` rounded corners (`border-radius: 8px`) across all cards, inputs, select dropdowns, and modals.
  - Filled primary buttons (`#1A73E8`), outlined secondary buttons (`#DADCE0` border), and text buttons.

* **Branding & Visual Identity**:
  - **Shield & Checkmark Motif**: Chosen to reflect academic integrity, proctoring security, and verified authenticity.
  - **Browser Title**: Explicitly set to `"IntegrityFlow — Examiner Dashboard"` across all browser tabs (`index.html`).
  - **Favicon & Icons**: Unified multi-size `.ico`, `.png` (64px, 192px, 512px), and `.svg` matching the Candidate Electron desktop app.
  - **Persistent Header Logo**: Integrated in `Dashboard.jsx` alongside the live connection status dot and teacher authentication profile.
  - **Asset Locations**:
    - `dashboard/public/favicon.ico`: Browser tab favicon (multi-size ICO).
    - `dashboard/public/favicon.png`: 64x64 PNG favicon.
    - `dashboard/public/logo192.png` & `logo512.png`: PWA / high-resolution web app icons.
    - `dashboard/public/logo.svg`: Scalable vector logo used across dashboard header and views.
    - `dashboard/src/assets/`: Source asset copies for React imports if needed.
    - `scripts/generate_branding_assets.py`: Central python generation script to update branding assets simultaneously across Electron and React.

---

## What This Does

The dashboard provides a complete exam management, real-time proctoring, human-in-the-loop violation triage, historical analytics, candidate identity verification, and secure examiner authentication suite:

1. **Teacher Authentication Flow (`Login.jsx`, `Signup.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`)**:
   - **Login**: Clean Material Card with email/password fields, "Log In" button, generic inline error messaging ("Invalid email or password"), links to Signup and Forgot Password, and a 1-Click Demo Sign-in for fast FYP evaluation.
   - **Signup**: Full name, email, password, and confirmation password inputs with client-side instant validation (minimum 8 characters, at least 1 number). Redirects immediately to the dashboard upon account creation.
   - **Forgot Password**: Submits reset requests to `POST /auth/forgot-password` and displays standard confirmation messaging without user enumeration.
   - **Reset Password**: Reads recovery token from URL query parameters (`?token=...`), validates new password confirmation, and submits to `POST /auth/reset-password`.
   - **Persistent Header Controls**: Displays the logged-in examiner's avatar, full name, role, and a prominent "Log Out" button.

2. **Exam Management & Tab Filtering (`ExamManager.jsx`)**:
   - **Active vs. Completed Tabs**: Easily toggle between **Active & Draft Exams** and **Completed & Historical Exams**.
   - **Live Pulse Badge**: Active exams display a prominent green `"● LIVE"` glowing pulse indicator. Completed exams display a muted, settled visual state.
   - **Exam Creation Modal**: Prominent `+ Create Exam` button opens a Material dialog form allowing teachers to input an Exam Title, optional custom Exam Code, select initial status, and upload PDF/DOCX question papers.
   - **End Exam Workflow**: Teachers can click **"End Exam"** on an active card or directly from the Live Monitoring view with confirmation modal dialogs.
   - **Delete Exam Action**: Added a trash icon/button on exam cards (both active/draft and completed) with a confirmation dialog modal (*"Delete Exam? This will permanently delete this exam and clean up its question paper."*) that issues a `DELETE /exams/:examId` request to cleanly delete the exam.

3. **Historical Exam View & Summary Analytics (`ExamSummary.jsx`)**:
   - Clicking **"View Summary & Analytics"** on a completed exam opens an aggregated historical overview:
     - **3 Top Stat Cards**: Total Candidates, Total Violations, and Average Risk Score (with color coding).
     - **Candidate Performance Roster Table**: Shows each student who took the exam with their **Full Name** (primary text), **Roll Number** (secondary text), start time, total violation count, final risk score badge (`RiskScoreBadge`), and submission status badge (`Submitted` / `Not Submitted`).
     - **Export CSV & Print PDF**: Generates proctoring audit reports including Student Name and Roll Number columns.
     - **Evidence Review**: Clicking **"Review Evidence"** on any candidate row opens `<EvidenceViewer>` displaying their full screenshot and violation history.

4. **Live Student Monitoring & Candidate Identity (`StudentList.jsx` & `CandidateGrid.jsx`)**:
   - Displays real-time active student sessions showing **Student Full Name** (`studentName`) as prominent primary text, with **Roll Number (`rollNumber`) & Exam Code** underneath instead of raw session IDs.
   - Session ID remains accessible as a subtle tooltip/tag for technical debugging.
   - Live search input filters instantly across student names, roll numbers, exam codes, and session IDs.
   - Shows color-coded `RiskScoreBadge` indicators and a **"X New" unreviewed alerts badge** so a teacher can spot at a glance which students still need attention.

5. **Real-Time Alert Triage Feed (`AlertFeed.jsx`)**:
   - Live WebSocket scrolling feed of incoming violations with **visual distinction between unreviewed alerts** (glowing primary blue border, background tint) and **reviewed alerts** (muted, settled style).
   - **Filter Controls**: "All", "Needs Review", and "Reviewed" quick-filter tabs.
   - **Quick-Action Buttons**: Quick **"Confirm"** and **"Dismiss"** buttons, plus an **"Add Note"** modal for reviewer comments.

6. **Evidence Timeline & Inline Review (`EvidenceViewer.jsx`)**:
   - Control bar header displays **"Viewing: [Student Full Name] ([Roll Number])"** with active status, exam code, and subtle session ID.
   - Chronological timeline rendering violation evidence, severity tags, screenshot images, and **live review status badges** with reviewer notes. Works seamlessly for active and historical completed sessions.

---

## Candidate Identity & Flow Integration

In IntegrityFlow, candidate sessions capture human identity right at the start of their examination lifecycle:
```
[Exam Code Check] → [Python AI Splash Check] → [Consent Agreement] → [Identity Capture: Full Name + Roll #] → [Hardware Self-Check] → [Active Exam Workspace]
```

### Dashboard Display Rules
1. **StudentList**: Renders `student.studentName` as primary bold text (`14px font-weight: 500`), with `Roll: {student.rollNumber} • Exam: {student.examId}` underneath. Hover tooltip shows internal `Session ID: {student.sessionId}` for debugging.
2. **CandidateGrid**: Card headers display `studentName` (or fallbacks) and `Roll: {rollNumber}` alongside real-time webcam feed/preview.
3. **EvidenceViewer**: Header prominently reads `Viewing: {studentName} ({rollNumber})` with session badge and exam code.
4. **ExamSummary**: Completed candidate roster displays `studentName` (primary text) and `rollNumber` (secondary text). CSV Export includes `Student Name` and `Roll Number` columns for academic record keeping.

---

## Architecture Note: Secure In-Memory Tokens & Silent Refresh

### Why Never Store Access Tokens in `localStorage` or `sessionStorage`?
In browser applications, any JavaScript running on the page (including third-party scripts, browser extensions, or malicious scripts injected via Cross-Site Scripting / XSS) can read `window.localStorage` and `window.sessionStorage`. If a JWT access token or refresh token is stored in `localStorage`, a single XSS vulnerability exposes the entire teacher credential to immediate theft.

### The Two-Tier Strategy: In-Memory Access Token + `httpOnly` Refresh Cookie
1. **Access Token in React Memory**: The short-lived JWT access token (15-minute lifespan) is stored **strictly in JavaScript runtime memory** (`AuthContext` state and module closure). It is **never** written to `localStorage` or `sessionStorage`.
2. **`httpOnly` Refresh Cookie**: The long-lived refresh token is stored inside an `httpOnly`, `SameSite: strict` (or `lax` in dev), `secure` cookie managed exclusively by the browser network stack. JavaScript cannot read or steal this cookie.

### Silent Refresh on App Load & Seamless Page Restarts
When an examiner opens the dashboard or reloads their browser:
1. `AuthContext` initializes with `isLoading = true` and shows a full-screen loading spinner (preventing UI flickering).
2. `AuthContext` automatically sends a `POST /auth/refresh` request with `credentials: 'include'`.
3. The browser sends the `httpOnly` refresh cookie. The backend verifies and rotates the refresh token, returning a fresh short-lived access token in the JSON response payload.
4. `AuthContext` loads the examiner's profile via `GET /auth/me` and updates `currentTeacher` in memory, seamlessly restoring the examiner's session across app restarts without ever exposing persistent tokens to web storage.

### Automatic 401 Interception & Token Rotation
Both `AuthContext.authFetch` and Axios `api.js` implement automatic response interceptors:
- If an API request receives an HTTP `401 Unauthorized` (e.g. because the in-memory access token expired after 15 minutes):
  1. The interceptor intercepts the failure before it bubbles up to component state.
  2. The interceptor makes a single `POST /auth/refresh` call with `credentials: 'include'`.
  3. Upon receiving the new access token, it updates the in-memory token, updates the original request's `Authorization: Bearer <newToken>` header, and immediately retries the original request.
  4. The examiner experiences zero interruption and no dropped requests.
  5. If the refresh cookie itself is expired or revoked, the interceptor cleanly clears in-memory state and redirects to the Login screen.

---

## Files Changed/Added

- `dashboard/src/components/StudentList.jsx`: Updated candidate list items to render `studentName` as primary text and `rollNumber` as secondary subtitle. Retained `sessionId` in hover tooltip and updated search filtering to match name, roll number, exam code, and session ID.
- `dashboard/src/components/EvidenceViewer.jsx`: Updated header title to `"Viewing: [studentName] ([rollNumber])"`, fixed endpoint URL in `fetchSessionData`, and retained debug metadata.
- `dashboard/src/components/ExamSummary.jsx`: Updated historical exam summary candidate roster table to show `studentName` (primary) and `rollNumber` (secondary). Updated CSV export generation with `Student Name` and `Roll Number` columns.
- `dashboard/src/components/CandidateGrid.jsx`: Updated card header to show `studentName` and `rollNumber`.
- `dashboard/src/context/AuthContext.jsx`: Implemented secure in-memory access token storage, `currentTeacher`, `isLoading`, `login()`, `signup()`, `logout()`, `forgotPassword()`, `resetPassword()`, `demoLogin()`, silent refresh on mount, and automatic 401 retry fetch wrapper.
- `dashboard/src/services/api.js`: Updated Axios client to attach in-memory tokens dynamically, enforce `withCredentials: true`, and automatically intercept 401s to perform silent refresh and request replay.
- `dashboard/src/pages/Login.jsx`: Material Design centered login card with email/password authentication, generic error handling, and links to Signup/Forgot Password.
- `dashboard/src/pages/Signup.jsx`: Material Design signup card with client-side password validation (min 8 chars, 1 number), confirmation matching, and immediate dashboard redirect.
- `dashboard/src/pages/ForgotPassword.jsx`: Form consuming `POST /auth/forgot-password` with standard success feedback.
- `dashboard/src/pages/ResetPassword.jsx`: Form consuming `POST /auth/reset-password` with query parameter token extraction (`?token=...`).
- `dashboard/src/pages/Auth.css`: Material Design stylesheet for authentication views, input containers, error banners, and loading spinners.
- `dashboard/src/App.jsx`: Updated with route protection, silent refresh loading splash, unauthenticated view routing (`Login`, `Signup`, `ForgotPassword`, `ResetPassword`), and browser URL synchronization.
- `dashboard/src/pages/Dashboard.jsx`: Integrated persistent header with logged-in examiner badge, name, role, and "Log Out" action.
- `dashboard/DASHBOARD.md`: Updated with candidate identity flow notes, UI component specs, file manifest, and testing procedures.

---

## Testing This Step

### 1. Full Candidate Lifecycle & Identity Verification
1. Open the Candidate Electron app.
2. Enter an active Exam Code (e.g. `CS401-MID`) and click **"Continue to Consent"**.
3. Read the monitoring consent notice and click **"I Understand & Agree"**.
4. On the new **Identity Verification** screen (`identity.html`), enter:
   - **Full Name**: `"John Doe"`
   - **Roll Number**: `"2022-CS-101"`
5. Click **"Verify & Continue"** (which securely creates the session with `POST /sessions`).
6. Complete the self-check tests (camera, audio, browser checks) and click **"Begin Exam"**.
7. In the Examiner Dashboard:
   - Check the **StudentList**: Verify `"John Doe"` is rendered in bold primary text, with `"Roll: 2022-CS-101 • Exam: CS401-MID"` below it.
   - Click on the student item: Verify the **EvidenceViewer** header displays `"Viewing: John Doe (2022-CS-101)"`.
   - Submit or complete the exam: Navigate to **Completed Exams** -> **View Summary & Analytics** in `ExamManager`. Verify `"John Doe"` and `"2022-CS-101"` appear in the candidate roster table and in the exported CSV report.

### 2. Backend Validation Rejection Test
1. Make a `POST /sessions` request omitting `studentName` or `rollNumber`:
   ```bash
   node -e "fetch('http://localhost:5000/sessions', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({examId: 'CS401-MID'})}).then(r => r.json()).then(console.log)"
   ```
2. Verify HTTP `400 Bad Request` is returned with `{ error: "studentName and rollNumber are required to create a session." }`.

### 3. Examiner Authentication & Silent Refresh
1. Open `http://localhost:5173`, log in or click **"1-Click Demo Login"**.
2. Press `F5` to reload: confirm silent refresh restores the session in under 1 second without storing tokens in `localStorage`.
