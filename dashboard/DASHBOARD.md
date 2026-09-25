# IntegrityFlow Dashboard Documentation

## Project Context: What Are We Building & How?
**What we are building:** We are building the examiner dashboard for **IntegrityFlow**, an AI-powered exam proctoring system. This dashboard acts as the central command center for human examiners. It allows teachers to create and manage exam codes, upload question papers, monitor active candidate sessions in real-time, view automated risk scores for each student, review captured evidence of potential violations, triage/review violation alerts with decision controls, and **review historical exam analytics & candidate performance rosters after an exam completes**.

**How we are building it:** The dashboard is built using **React** (bootstrapped via **Vite**) with a **Material Design** visual system. It connects to our Node.js backend using:
1. **Axios & Fetch (REST API)**: For teacher authentication, exam creation, candidate session queries, status lifecycle updates, violation review triage (`PATCH /violations/:violationId/review`), ending exam sessions (`PATCH /exams/:examId/status`), fetching historical exam summaries (`GET /exams/:examId/summary`), and fetching screenshot evidence.
2. **Socket.io (WebSockets)**: For persistent connection to receive instant alert feeds when a violation occurs, live multi-client broadcast of violation review decisions (`violationReviewed`), and real-time re-ranking of the cross-student Priority Queue.

---

## High-Priority Examiner Improvements Status Summary

| Module Improvement | Scope | Status |
| :--- | :--- | :--- |
| **1. Exam Creation & Code System** | Backend `Exam` model, `POST /exams` paper upload, custom/auto code generation, candidate app code validation. | **COMPLETE** ✅ |
| **2. Violation Review & Triage Workflow** | Backend `PATCH /violations/:violationId/review`, Socket.io `violationReviewed` broadcast, AlertFeed quick confirm/dismiss, notes modal, unreviewed badges. | **COMPLETE** ✅ |
| **3. Historical Exam View & Analytics Summary** | Backend `GET /exams?status=completed` filter, `GET /exams/:examId/summary` analytics aggregator, ExamManager tabs, End Exam confirmation dialog, ExamSummary stat cards & candidate roster. | **COMPLETE** ✅ |
| **4. Secure In-Memory Auth & Full Examiner Auth UI Flow** | `AuthContext` with strict in-memory tokens & silent refresh on mount, Axios 401 retry interceptor, Material `Login`, `Signup`, `ForgotPassword`, `ResetPassword`, and App route protection. | **COMPLETE** ✅ |
| **5. Candidate Identity & Real Student Names** | Dashboard `StudentList` displays `studentName` (primary) and `rollNumber` (secondary), `EvidenceViewer` header displays `Viewing: [Student Name] ([Roll Number])`, `ExamSummary` candidate roster and CSV export include real student names. | **COMPLETE** ✅ |
| **6. Multi-Student Scalability & Performance** | MongoDB compound indexes (`{ sessionId: 1, timestamp: -1 }`, `{ reviewed: 1 }`, `{ sessionId: 1, reviewed: 1 }`, `{ examId: 1, status: 1 }`), `GET /violations/priority-queue`, cross-student Severity-First Priority Queue tab, client-side 2-minute repeated alert grouping. | **COMPLETE** ✅ |

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

5. **Cross-Student Priority Queue (`PriorityQueue.jsx`)**:
   - Cross-student, severity-ranked triage list querying `GET /violations/priority-queue`.
   - Returns unreviewed violations across all active sessions, sorted by `severity: -1, timestamp: -1` (high severity 0.9–1.0 immediately float to the top regardless of occurrence order).
   - Enriched with candidate identity (`studentName`, `rollNumber`, `examId`) so examiners know immediately who triggered the alert without secondary lookups.
   - Live updates via Socket.io `violation` and `violationReviewed` events, automatically maintaining severity order without manual page refreshes.
   - Built-in quick triage (**Confirm** / **Dismiss** / **Add Note**) and direct link to candidate evidence timeline.

6. **Real-Time Alert Triage Feed (`AlertFeed.jsx`) & 2-Minute Grouping**:
   - Live WebSocket scrolling feed of incoming violations for a selected candidate or exam.
   - **Visual Distinction**: Unreviewed alerts (glowing primary blue border, background tint) vs. reviewed alerts (muted, settled style).
   - **Filter Controls**: "All", "Needs Review", and "Reviewed" quick-filter tabs.
   - **2-Minute Repeated Alert Collapsing**: Consecutive infractions of the same type within 2 minutes collapse into a single summary entry (e.g. `3× Head Turned Away`) with an expandable chevron to inspect individual timestamps and evidence snapshots.

7. **Evidence Timeline & Inline Review (`EvidenceViewer.jsx`)**:
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

## Architecture Note: Client-Side Grouping of Repeated Violations & Data Integrity

### Why Grouping is Client-Side Only (Presentation Layer vs. Data Source of Truth)
During proctoring sessions, rapid micro-movements (such as a student looking away from their screen 3 times in 45 seconds) produce multiple distinct violation events from the candidate AI module. A naive dashboard presentation would flood the examiner with duplicate rows, causing cognitive overload.

However, collapsing or merging these records inside the database or backend API responses would introduce severe architectural drawbacks:
1. **Data Loss & Audit Trail Tampering**: Academic integrity defense requires exact microsecond timestamps and individual screenshot evidence for every infraction. Collapsing records at the database level destroys discrete timestamps and evidentiary links.
2. **Risk Scoring Precision**: The backend exponential decay risk scoring algorithm ($R(t) = \sum v_i \cdot e^{-\lambda(t - t_i)}$) relies on exact mathematical arrival intervals ($t - t_i$). Merging rows into single "grouped" database entries corrupts decay calculations.
3. **Decoupling Concerns**: The database and backend API maintain **uncompromised, loss-free data integrity** as the authoritative source of truth. The dashboard acts as an intelligent **presentation layer** that aggregates consecutive same-student, same-type violations within a 2-minute sliding window (`groupViolationsList()`) for examiner readability without altering the underlying data model.
4. **Interactive Drill-Down**: Because the underlying data remains intact, examiners can expand any grouped alert (`3× Head Turned Away`) with one click to inspect individual timestamps, confidence scores, and visual evidence.

---

## Files Changed/Added

- `dashboard/src/components/PriorityQueue.jsx`: Added the cross-student, severity-ranked triage feed with live Socket.io re-sorting, 2-minute consecutive grouping, inline confirm/dismiss actions, and evidence timeline drill-down.
- `dashboard/src/components/AlertFeed.jsx`: Integrated 2-minute repeated alert grouping (`3× Head Turned Away`) with expandable child instances and preserved per-student triage workflow.
- `dashboard/src/components/PriorityQueue.css`: Dedicated styling for the Priority Queue tab, severity color bars, grouped counter badges, and nested instance lists.
- `dashboard/src/components/StudentList.jsx`: Updated candidate list items to render `studentName` as primary text and `rollNumber` as secondary subtitle. Retained `sessionId` in hover tooltip and updated search filtering to match name, roll number, exam code, and session ID.
- `dashboard/src/components/EvidenceViewer.jsx`: Updated header title to `"Viewing: [studentName] ([rollNumber])"`, fixed endpoint URL in `fetchSessionData`, and retained debug metadata.
- `dashboard/src/components/ExamSummary.jsx`: Updated historical exam summary candidate roster table to show `studentName` (primary) and `rollNumber` (secondary). Updated CSV export generation with `Student Name` and `Roll Number` columns.
- `dashboard/src/components/CandidateGrid.jsx`: Real-time candidate gallery with verification photos, live connection indicators, dynamic risk gauges, 1-click +5m/+10m exam extensions, direct evidence review, and 1-on-1 chat launcher.
- `dashboard/src/components/LiveExamChat.jsx`: Zoom/Meet-style proctored exam communication center supporting exam-wide broadcast announcements, candidate channels with student Name & Roll Number, unread counters, and instant responses.
- `dashboard/src/pages/Dashboard.jsx`: Top navigation toolbar integration with "Priority Queue" tab (primary triage view with `Zap` icon) and responsive mobile drawer navigation.
- `dashboard/src/pages/Dashboard.css`: Full responsive overhaul with media queries (`1200px`, `992px`, `768px`, `600px`), fluid split-view to vertical stack transition, hidden scrollbar touch sub-tabs, and mobile header wrap.
- `dashboard/src/components/Components.css`: Responsive modal card constraints (`94vw`/`90vh`), auto-fit candidate card grid (`minmax(280px, 1fr)`), table horizontal scroll wrappers, and touch tap target optimizations.
- `dashboard/DASHBOARD.md`: Updated with candidate identity flow notes, Priority Queue specs, client-side grouping architecture notes, and testing procedures.

---

## Responsive Design & Breakpoint Architecture

The examiner dashboard features a responsive layout ensuring full functionality across desktop workstations, laptops, tablets, and mobile devices:

| Breakpoint Tier | Max Width | Target Devices | Layout Behavior |
| :--- | :--- | :--- | :--- |
| **Large Desktop** | $\ge 1200\text{px}$ | 1080p / 1440p / 4K Monitors | 2-Column Split View (`.dashboard-left` 380px, `.dashboard-right` flex 1), full fixed viewport height (`100vh - 64px`). |
| **Medium Desktop / Laptop** | $992\text{px} - 1200\text{px}$ | 13"–15" Laptops, Surface Pro | Sidebar scales to 320px, compact gutters (`16px`), all 4 sub-tabs fit cleanly. |
| **Tablet Viewport** | $768\text{px} - 992\text{px}$ | iPad, Android Tablets (Portrait & Landscape) | Dashboard switches to fluid **single-column vertical stack**; candidate roster top with scroll limit, right panel expands below with minimum height 520px. |
| **Mobile Viewport** | $< 768\text{px}$ | Smartphones, narrow browser windows | Header compresses into wrapped flex row; `.sub-tabs` and `.exam-tabs-bar` enable frictionless horizontal swiping without scrollbars; modals fit comfortably with `94vw` bounds. |

### Key Responsive Features
1. **Adaptive Header & Mobile Navigation Drawer**:
   - **Desktop ($\ge 992\text{px}$)**: Full horizontal Material navigation bar displaying brand logo, navigation tabs (`Exams & Analytics`, `Live Monitoring`, `Admin Console`), sound chime toggle, online connection pill, and teacher profile / demo sign-in controls.
   - **Tablets & Mobile ($< 992\text{px}$)**: Header automatically compresses into a clean, single-line app bar with quick sound toggle, live status indicator dot, and a touch hamburger menu button (`Menu` / `X`).
   - **Slide-Down Mobile Drawer**: Tapping the hamburger opens an overlay menu containing navigation items, active tab indicators, and full user profile / demo login controls.
2. **Touch-Friendly Sub-Tabs**: The 5 monitoring sub-tabs (`Priority Queue`, `Live Feed`, `Webcam Grid`, `Evidence Review`, `Exam Chat`) use CSS flex and `overflow-x: auto; white-space: nowrap; scrollbar-width: none;` allowing examiners on tablets/phones to swipe between views without clipped or wrapped text.
3. **Auto-Reflow Candidate Grid**: Candidate webcam cards reflow dynamically using `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` on desktop/tablets and `1fr` on mobile devices.
4. **Table & Card Containment**: Analytics tables and summary cards incorporate touch-safe horizontal wrappers preventing viewport overflow while keeping data rows fully readable.

---

## Live Multi-Candidate Gallery & In-Exam Chat Features

### 1. Live Multi-Candidate Grid (`CandidateGrid.jsx`)
- **Card Layout**: Shows real-time candidate cards with student name, roll number, verification selfie thumbnail, and active connection status dot.
- **Dynamic Risk Gauge**: Color-coded risk badge (Low: Green `#166534`, Moderate: Amber `#b45309`, High: Red `#b91c1c`).
- **1-Click Direct Proctor Actions**:
  - 🔍 **Review**: Instantly transitions to the evidence timeline.
  - 💬 **Chat**: Opens direct live chat on that candidate's channel.
  - ⏱️ **+5m / +10m**: Extends active exam duration across candidate sessions.
  - 🚀 **Batch Release**: Waiting lobby paper release countdown and trigger.

### 2. Live Exam Chat & Broadcast Center (`LiveExamChat.jsx`)
- **Dedicated Sub-Tab Inside Live Monitoring**: Situated directly alongside monitoring tabs, strictly scoped to the active exam (`selectedExamFilter`).
- **Inline Right-Panel Integration**: When selected (`rightPanelView === 'chat'`), seamlessly renders full-height within the dashboard right pane with zero modal obstruction or backdrop freezing.
- **Zoom / Meet Style Direct Inquiries**: Displays incoming student inquiries grouped into channels by candidate **Full Name & Roll Number** (e.g. `Muhammad Ali (FA20-BCS-042)`).
- **Broadcast Channel**: Send urgent paper announcements to all students simultaneously taking that active exam.
- **Direct Chat Launcher from Candidate Grid**: Clicking **"Chat"** on any candidate card in the Webcam Grid automatically focuses that student's channel and transitions to the Exam Chat tab.

---

## Testing This Step

### 1. Priority Queue Severity Ordering Verification
1. Ensure at least two test candidate sessions are active.
2. Trigger a low-severity infraction for Student A (e.g. `head_pose_turn`, severity 0.3) at time $T_1$.
3. Trigger a high-severity infraction for Student B (e.g. `multiple_faces`, severity 0.9) at time $T_2$ ($T_2 > T_1$).
4. Open the **Priority Queue** tab in the Examiner Dashboard.
5. **Verify**: Student B's high-severity infraction (0.9) appears **above** Student A's low-severity infraction (0.3), confirming severity-descending sorting takes priority over chronological arrival time.

### 2. Grouped Repeated Violations Verification (2-Minute Sliding Window)
1. Trigger 3 consecutive `head_pose_turn` infractions for Student A within 30 seconds.
2. In both the **Priority Queue** and the candidate's **Live Feed**:
   - Confirm the 3 infractions collapse into **one single grouped card** displaying `"3× Head Turned Away"` with the latest timestamp.
   - Click the expand toggle / chevron: confirm the card smoothly expands to display all 3 individual instances with their discrete timestamps, review controls, and snapshot links.
   - Click **"Confirm"** or **"Dismiss"** on one instance: confirm only that specific instance updates its review badge, leaving unreviewed instances intact.

### 3. Full Candidate Lifecycle & Identity Verification
1. Open the Candidate Electron app and enter Exam Code `CS401-MID`.
2. Agree to consent and enter candidate identity: `"John Doe"`, `"2022-CS-101"`.
3. Complete self-check and start the exam.
4. In the Examiner Dashboard:
   - Check **StudentList**: Verify `"John Doe"` renders in bold primary text with `"Roll: 2022-CS-101 • Exam: CS401-MID"` below it.
   - Click the student: Verify **EvidenceViewer** header displays `"Viewing: John Doe (2022-CS-101)"`.
   - Complete the exam: Navigate to **Completed Exams** -> **View Summary & Analytics** in `ExamManager`. Verify `"John Doe"` and `"2022-CS-101"` appear in the roster and exported CSV report.

### 4. Load Testing Comparison (Indexes & Throughput)
- Run `python scripts/load_test.py --students 40 --duration 60 --with-reads` before and after index creation.
- Check [SERVER.md](file:///d:/BS_FYP%20Project/IntegrityFlow/server/SERVER.md) for full benchmark results showing a **30.4% reduction in P99 write latency** (771ms $\to$ 536ms) and **74.8% reduction in peak read latency** (1230ms $\to$ 310ms).
