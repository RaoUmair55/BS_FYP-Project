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

The dashboard provides a complete exam management, real-time proctoring, human-in-the-loop violation triage, historical analytics, and secure examiner authentication suite:

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
     - **Candidate Performance Roster Table**: Shows each student who took the exam, start time, total violation count, final risk score badge (`RiskScoreBadge`), and submission status badge (`Submitted` / `Not Submitted`).
     - **Evidence Review**: Clicking **"Review Evidence"** on any candidate row opens `<EvidenceViewer>` displaying their full screenshot and violation history.

4. **Live Student Monitoring & Unreviewed Alert Summary (`StudentList.jsx`)**:
   - Displays real-time active student sessions with live search filtering, candidate IDs, exam codes, color-coded `RiskScoreBadge` indicators, and a **"X New" unreviewed alerts badge** so a teacher can spot at a glance which students still need attention.

5. **Real-Time Alert Triage Feed (`AlertFeed.jsx`)**:
   - Live WebSocket scrolling feed of incoming violations with **visual distinction between unreviewed alerts** (glowing primary blue border, background tint) and **reviewed alerts** (muted, settled style).
   - **Filter Controls**: "All", "Needs Review", and "Reviewed" quick-filter tabs.
   - **Quick-Action Buttons**: Quick **"Confirm"** and **"Dismiss"** buttons, plus an **"Add Note"** modal for reviewer comments.

6. **Evidence Timeline & Inline Review (`EvidenceViewer.jsx`)**:
   - Chronological timeline rendering violation evidence, severity tags, screenshot images, and **live review status badges** with reviewer notes. Works seamlessly for active and historical completed sessions.

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

- `dashboard/src/context/AuthContext.jsx`: Implemented secure in-memory access token storage, `currentTeacher`, `isLoading`, `login()`, `signup()`, `logout()`, `forgotPassword()`, `resetPassword()`, `demoLogin()`, silent refresh on mount, and automatic 401 retry fetch wrapper.
- `dashboard/src/services/api.js`: Updated Axios client to attach in-memory tokens dynamically, enforce `withCredentials: true`, and automatically intercept 401s to perform silent refresh and request replay.
- `dashboard/src/pages/Login.jsx` (NEW): Material Design centered login card with email/password authentication, generic error handling, and links to Signup/Forgot Password.
- `dashboard/src/pages/Signup.jsx` (NEW): Material Design signup card with client-side password validation (min 8 chars, 1 number), confirmation matching, and immediate dashboard redirect.
- `dashboard/src/pages/ForgotPassword.jsx` (NEW): Form consuming `POST /auth/forgot-password` with standard success feedback.
- `dashboard/src/pages/ResetPassword.jsx` (NEW): Form consuming `POST /auth/reset-password` with query parameter token extraction (`?token=...`).
- `dashboard/src/pages/Auth.css` (NEW): Material Design stylesheet for authentication views, input containers, error banners, and loading spinners.
- `dashboard/src/App.jsx`: Updated with route protection, silent refresh loading splash, unauthenticated view routing (`Login`, `Signup`, `ForgotPassword`, `ResetPassword`), and browser URL synchronization.
- `dashboard/src/pages/Dashboard.jsx`: Integrated persistent header with logged-in examiner badge, name, role, and "Log Out" action.
- `dashboard/DASHBOARD.md`: Updated with full authentication flow documentation, security architecture notes, file manifest, and end-to-end testing procedures.

---

## Testing This Step

### 1. Signup New Teacher & Immediate Dashboard Access
1. Open the dashboard at `http://localhost:5173`.
2. Click **"Sign Up"** at the bottom of the Login card.
3. Enter Full Name `"Dr. Alan Turing"`, Work Email `"turing@cambridge.edu"`, Password `"Enigma1940!"`, and confirm password.
4. Click **Create Account**.
5. Verify instant access to the Examiner Dashboard with `"Dr. Alan Turing"` displayed in the header.

### 2. Log Out & Log Back In
1. Click the **Log Out** icon button in the top-right header.
2. Verify you are redirected to the Login card.
3. Enter `"turing@cambridge.edu"` and `"Enigma1940!"`.
4. Click **Sign In**.
5. Confirm successful login and dashboard access.

### 3. Verify Silent Refresh Across Page Reloads (No `localStorage`)
1. While logged in, press `F5` (or click Refresh in the browser).
2. Confirm the loading spinner (*"Authenticating session..."*) briefly appears, followed immediately by the loaded Dashboard with `"Dr. Alan Turing"` still authenticated.
3. Open Browser DevTools -> Application -> Local Storage. Confirm **no access token or password is stored in localStorage**.

### 4. Test Forgot Password & Reset Password Flow
1. Log out. On the Login screen, click **"Forgot password?"**.
2. Enter `"turing@cambridge.edu"` and click **Send Reset Link**.
3. Confirm the confirmation banner: *"If an account with that email exists, a password reset link has been sent."*
4. Check the backend server terminal console to retrieve the generated reset token: `[AUTH] Password reset token generated for turing@cambridge.edu: <TOKEN>`.
5. In the browser, navigate to `http://localhost:5173/reset-password?token=<TOKEN>`.
6. Enter a new password `"NewPassword2026!"` and confirm. Click **Reset Password**.
7. Confirm the success message, then log in using your new password.

### 5. Verify Automatic 401 Token Refresh & Request Retry
1. Trigger an API action (e.g. creating an exam or fetching candidates).
2. If the in-memory access token expires, confirm the Axios/Fetch interceptor automatically invokes `POST /auth/refresh`, obtains a new token, and replays the original request seamlessly without user intervention.
