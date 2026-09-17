# IntegrityFlow Dashboard Documentation

## Project Context: What Are We Building & How?
**What we are building:** We are building the examiner dashboard for **IntegrityFlow**, an AI-powered exam proctoring system. This dashboard acts as the central command center for human examiners. It allows teachers to create and manage exam codes, upload question papers, monitor active candidate sessions in real-time, view automated risk scores for each student, review captured evidence of potential violations, triage/review violation alerts with decision controls, and **review historical exam analytics & candidate performance rosters after an exam completes**.

**How we are building it:** The dashboard is built using **React** (bootstrapped via **Vite**) with a **Material Design** visual system. It connects to our Node.js backend using:
1. **Axios & Fetch (REST API)**: For exam creation, candidate session queries, status lifecycle updates, violation review triage (`PATCH /violations/:violationId/review`), ending exam sessions (`PATCH /exams/:examId/status`), fetching historical exam summaries (`GET /exams/:examId/summary`), and fetching screenshot evidence.
2. **Socket.io (WebSockets)**: For persistent connection to receive instant alert feeds when a violation occurs and live multi-client broadcast of violation review decisions (`violationReviewed`).

---

## High-Priority Examiner Improvements Status Summary

| Module Improvement | Scope | Status |
| :--- | :--- | :--- |
| **1. Exam Creation & Code System** | Backend `Exam` model, `POST /exams` paper upload, custom/auto code generation, candidate app code validation. | **COMPLETE** ✅ |
| **2. Violation Review & Triage Workflow** | Backend `PATCH /violations/:violationId/review`, Socket.io `violationReviewed` broadcast, AlertFeed quick confirm/dismiss, notes modal, unreviewed badges. | **COMPLETE** ✅ |
| **3. Historical Exam View & Analytics Summary** | Backend `GET /exams?status=completed` filter, `GET /exams/:examId/summary` analytics aggregator, ExamManager tabs, End Exam confirmation dialog, ExamSummary stat cards & candidate roster. | **COMPLETE** ✅ |

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

---

## What This Does

The dashboard provides a complete exam management, real-time proctoring, human-in-the-loop violation triage, and historical analytics suite:

1. **Exam Management & Tab Filtering (`ExamManager.jsx`)**:
   - **Active vs. Completed Tabs**: Easily toggle between **Active & Draft Exams** and **Completed & Historical Exams**.
   - **Live Pulse Badge**: Active exams display a prominent green `"● LIVE"` glowing pulse indicator. Completed exams display a muted, settled visual state.
   - **Exam Creation Modal**: Prominent `+ Create Exam` button opens a Material dialog form allowing teachers to input an Exam Title, optional custom Exam Code, select initial status, and upload PDF/DOCX question papers.
   - **End Exam Workflow**: Teachers can click **"End Exam"** on an active card or directly from the Live Monitoring view with confirmation modal dialogs.
   - **Delete Exam Action**: Added a trash icon/button on exam cards (both active/draft and completed) with a confirmation dialog modal (*"Delete Exam? This will permanently delete this exam and clean up its question paper."*) that issues a `DELETE /exams/:examId` request to cleanly delete the exam.

2. **Historical Exam View & Summary Analytics (`ExamSummary.jsx`)**:
   - Clicking **"View Summary & Analytics"** on a completed exam opens an aggregated historical overview:
     - **3 Top Stat Cards**: Total Candidates, Total Violations, and Average Risk Score (with color coding).
     - **Candidate Performance Roster Table**: Shows each student who took the exam, start time, total violation count, final risk score badge (`RiskScoreBadge`), and submission status badge (`Submitted` / `Not Submitted`).
     - **Evidence Review**: Clicking **"Review Evidence"** on any candidate row opens `<EvidenceViewer>` displaying their full screenshot and violation history.

3. **Live Student Monitoring & Unreviewed Alert Summary (`StudentList.jsx`)**:
   - Displays real-time active student sessions with live search filtering, candidate IDs, exam codes, color-coded `RiskScoreBadge` indicators, and a **"X New" unreviewed alerts badge** so a teacher can spot at a glance which students still need attention.

4. **Real-Time Alert Triage Feed (`AlertFeed.jsx`)**:
   - Live WebSocket scrolling feed of incoming violations with **visual distinction between unreviewed alerts** (glowing primary blue border, background tint) and **reviewed alerts** (muted, settled style).
   - **Filter Controls**: "All", "Needs Review", and "Reviewed" quick-filter tabs.
   - **Quick-Action Buttons**: Quick **"Confirm"** and **"Dismiss"** buttons, plus an **"Add Note"** modal for reviewer comments.

5. **Evidence Timeline & Inline Review (`EvidenceViewer.jsx`)**:
   - Chronological timeline rendering violation evidence, severity tags, screenshot images, and **live review status badges** with reviewer notes. Works seamlessly for active and historical completed sessions.

---

## Files Changed/Added

- `server/src/routes/exams.js`: Updated `GET /exams` to support `?status=completed`/`active` query parameter filtering, added `GET /exams/:examId/summary` endpoint aggregating participant counts, total violations, average risk score, and submission statuses, and updated `PATCH /exams/:examId/status` to automatically close out active student sessions when an exam ends.
- `dashboard/src/components/ExamSummary.jsx` (NEW): Historical exam summary analytics component rendering stat cards, student performance roster table, and inline evidence viewer modal.
- `dashboard/src/components/ExamManager.jsx`: Updated with Active/Completed tabs, glowing `"● LIVE"` status badges, muted completed cards, "End Exam" confirmation dialog modal, and "View Summary" triggers.
- `dashboard/src/pages/Dashboard.jsx`: Integrated `ExamSummary` view routing, active exam scoping, and Live Monitoring "End Exam" button header control.
- `dashboard/src/components/Components.css`: Added styles for tab bars, pulse animations, completed cards, stat cards, summary tables, submission badges, and confirmation dialog modals.

---

## Testing This Step

1. **Create and Run an Exam**:
   - Open dashboard at `http://localhost:5173`.
   - On **Exams & Analytics**, click **+ Create Exam**, title it `"Physics Mechanics CS301"`, code `"PHYS-301"`, status `Active`.
   - Confirm it appears under **Active & Draft Exams** with a glowing green `"● LIVE"` badge.

2. **Trigger Student Session & Violations**:
   - Connect a student candidate using code `"PHYS-301"`.
   - Trigger violation alerts. Confirm student appears in Live Monitoring with violations and risk score.

3. **End Exam Flow**:
   - Click **End Exam** on the active card (or in the Live Monitoring header).
   - Confirm the confirmation dialog modal appears (*"End this exam? Students will no longer be able to join or submit."*).
   - Click **Confirm End Exam**.
   - Confirm the exam moves cleanly into the **Completed & Historical Exams** tab.

4. **Verify Historical Summary & Evidence**:
   - Switch to **Completed & Historical Exams** tab.
   - Click **View Summary & Analytics** on `"Physics Mechanics CS301"`.
   - Confirm aggregated stat cards display accurate candidate count, total violations, and average risk score.
   - Confirm candidate table lists the student with their final risk score, violation count, and submission status.
   - Click **Review Evidence** on the student row -> verify full screenshot evidence timeline opens cleanly.
