# Candidate App (Electron Shell)

The Candidate App is the desktop application run by students during an exam. It serves as a secure wrapper that bundles the user interface with our AI monitoring module.

## What This Does

This module implements the full end-to-end exam experience, AI monitoring pipeline, **Module 1: Whitelist Enforcement**, **Module 2: AI Monitoring**, **Module 7: File & Typed Text Submissions**, and **Section 10.4 of the Scope Document (Data Ethics & Informed Consent)**:
1. **Startup**: The Electron main process boots up and immediately starts a local Express receiver on `ELECTRON_RECEIVER_PORT` (e.g., 8766).
2. **Dynamic Login & Session Initialization**: Candidate logs in with Student ID, Name, and Exam Code. Electron creates the session on the central server.
3. **Informed Consent Screen (Section 10.4 Data Ethics)**:
   - Before any self-check or monitoring begins, the student is presented with `consent.html` ("Before You Begin").
   - Explains in plain, student-friendly language what is monitored (camera orientation/multi-face, process whitelist, screenshots **only** on violations).
   - Prominently clarifies our privacy commitments: **continuous video is NEVER recorded or stored in files/databases** (in-memory frame analysis only), and **no biometric facial profiling databases are created**.
   - Requires explicit checkbox agreement: *"I understand and consent to this monitoring for the duration of this exam."*
   - "Continue to Identification" remains disabled until consent is checked.
   - Provides an explicit "Decline & Exit" option that gracefully exits the application.
4. **Identity Capture & Session Creation (`identity.html`)**:
   - Following consent, candidate provides **Full Name** (e.g., `Muhammad Ali`) and **Roll / Registration Number** (e.g., `FA20-BCS-042`).
   - Validates input format (non-empty, minimum length, valid institutional alphanumeric characters).
   - **Consolidated Session Creation**: Submits `POST /sessions` to create the MongoDB session with `studentName`, `rollNumber`, `studentId`, `examId`, and verified consent flags.
5. **AI Module Spawning & Self-Check Flow (`selfCheck.html`)**:
   - Displays candidate identification badge.
   - Runs camera check, microphone check, and background process whitelist verification.
   - Captures and uploads initial reference selfie to `POST /sessions/:sessionId/camera-verification`.
   - "Begin Exam" switches Python daemon into strict `exam` mode and opens workspace.
6. **Whitelist & AI Monitoring**: `WhitelistEnforcer` scans processes every 2.5s while `AIMonitor` tracks head pose, missing faces, multi-person events, and unauthorized physical objects.
7. **Two-Panel Exam Workspace (Module 7B & Module 7)**:
   - **Header Bar**: Displays `Student: [Full Name] ([Roll Number])`, `Exam: [Exam Code]`, Reassuring `● Monitoring Active` badge, running HH:MM:SS timer.
   - **Left Panel**: In-app paper viewer (rendering PDF/DOCX inside Electron without external viewers).
   - **Right Panel**: Answer area with tabs for (a) plain typed text with auto-saving to local storage, and (b) file attachment upload (.pdf, .docx, .py, .cpp, .zip).
   - **Submission Flow**: Prominent "Submit Exam" button with confirmation modal, retryable network failure handling, and MongoDB persistence.
8. **Violation Detection & Screenshot Capture**: Captures screenshots (<200KB) with microsecond timestamps and forwards to central server.

---

## Architecture — Modular Design (Dependency Inversion Principle)

The Candidate App's AI monitoring engine applies the **Dependency Inversion Principle (DIP)** from SOLID principles for evidence capture and violation logging:
- **`CaptureProvider` (Abstract Base Class)**: Defines the required `capture(session_id, violation_type) -> Optional[str]` contract using Python's `abc.ABC`.
- **`MssCaptureProvider` (Concrete Implementation)**: Implements fast, multi-monitor desktop capture via the `mss` library, dynamically downsampling JPEG quality to guarantee lightweight payloads (<200KB) with microsecond timestamp collision prevention.
- **`WebcamCaptureProvider` (Concrete Implementation)**: Encodes and captures active webcam video frames with annotated bounding boxes for camera violations (unauthorized cell phone, head turn, second person).
- **Single Swap Point (`ai-module/services/capture/__init__.py`)**: Exports the active provider instances and convenience helpers (`capture_screenshot`, `capture_webcam_frame`).

---

## Branding & Visual Identity

The Candidate App features unified **IntegrityFlow** branding engineered for an industry-grade, secure desktop experience:

* **Icon & Motif Rationale**:
  - **Shield Motif**: Reflects the integrity, proctoring security, and trustworthy academic evaluation theme of the project.
  - **Integrated Checkmark / Flow**: Represents verification, seamless workflow, and authorized progress.
  - **Color Palette**: Google Material Blue (`#1A73E8` primary, `#1557D0` dark, `#E8F0FE` subtle tint) ensuring 100% visual parity with the Examiner Dashboard without clashing accent colors.

* **Asset Locations**:
  - `candidate-app/electron/assets/icon.ico`: Multi-resolution Windows application icon (16px to 256px).
  - `candidate-app/electron/assets/icon.png`: High-resolution 512x512 master PNG icon.
  - `candidate-app/electron/build/icon.ico`: `electron-builder` packaging resource for Windows installers and taskbar icons.
  - `candidate-app/renderer/assets/icon.png` & `logo.svg`: Web/renderer vector and bitmap logos used in screens.
  - `scripts/generate_branding_assets.py`: Automated asset generator script to regenerate all icons and favicons across the repository.

* **Desktop Application Shell Configurations**:
  - **Explicit Window Title**: `BrowserWindow` title explicitly set to `"IntegrityFlow"` in `electron/main.js`.
  - **Product Name**: `productName: "IntegrityFlow"` set in `package.json` and `electron/package.json` (displays in Task Manager and OS process list).
  - **Splash / Loading Screen (`renderer/splash.html`)**: Displayed immediately upon candidate login while the Python AI background daemon spawns and health-checks (`/health`), preventing blank window delays and displaying an animated status indicator (*"Starting exam environment..."*).

---

## Files Changed/Added

- `renderer/identity.html` & `renderer/identity.js` (NEW): Candidate identity capture interface requesting Full Name and Roll/Registration Number, client-side format validation, and consolidated `POST /sessions` creation.
- `renderer/consent.html` & `renderer/consent.js`: Transition updated to route cleanly from informed consent to identity capture (`proceedToIdentity`).
- `renderer/login.html` & `renderer/login.js`: Streamlined exam code entry and validation.
- `renderer/selfCheck.html` & `renderer/selfCheck.js`: Candidate identification badge displaying name and roll number alongside verification checks.
- `renderer/examScreen.html` & `renderer/examScreen.js`: Candidate identification header badge displaying `Student: [Name] ([Roll Number])`.
- `electron/main.js`: Added `proceed-to-identity` and updated `proceed-to-self-check` IPC handlers with active session state tracking.
- `electron/preload.js`: Exposed `proceedToIdentity()` and updated `proceedToSelfCheck(identityData)`.
- `electron/package.json`: Added `identity.js` to esbuild `build:renderer` bundle script.
- `renderer/splash.html`: Startup splash screen with pulsing IntegrityFlow shield logo and progress bar displayed during Python initialization.
- `electron/assets/icon.ico` & `icon.png`: Application taskbar, title bar, and installer icon assets.
- `CANDIDATE.md`: Updated with full 4-step sequence documentation (`consent → identity → self-check → exam`).

## Safety List

The `WhitelistEnforcer` maintains a strict `SAFETY_LIST` of critical Windows system processes (e.g., `svchost.exe`, `explorer.exe`, `lsass.exe`) that are never terminated, ensuring OS stability. 
**Note:** The safety list protects the OS, not convenience apps that could be used to bypass monitoring. The AI module itself is protected by its explicit PID (`os.getpid()`), not by broadly allowing `python.exe` or `cmd.exe`.

## Dev vs Exam Mode

To facilitate local development while maintaining strict security during real exams, the whitelist system supports two modes configured via the `APP_MODE` environment variable:
- **Dev Mode (`APP_MODE=dev`)**: Uses the `dev_whitelist` which is relaxed and allows development tools like `cmd.exe`, `powershell.exe`, and `code.exe` (VS Code). This prevents the AI module from aggressively killing your own development environment while you are building and testing the application.
- **Exam Mode (`APP_MODE=exam`)**: Uses the strict `exam_whitelist`. This is the real enforcement configuration that will kill terminals, editors, and other unauthorized tools to prevent cheating. Note: `EXAM_BLOCKED` (not `ALWAYS_BLOCKED`) only applies in exam mode. Development requires browsers/shells/local AI tools to function; these are only forbidden during a real exam session, not during our own development.

**Fail-Safe Default**: If `APP_MODE` is not specified, it safely defaults to `exam` mode. This ensures that if the mode is ever forgotten or misconfigured in production, it fails SAFE (strict) rather than open (relaxed). You can switch modes by updating the `.env` file in the `candidate-app` directory.

## Architecture Note: Mode Transition
The `selfCheck.html` screen serves as a deliberate and necessary transition point between the relaxed `dev` environment and the strict `exam` environment. Without this, starting the Electron app directly in `exam` mode would immediately aggressively kill any development tools (terminals, IDEs, local AI instances) running on the same machine, making testing and development extremely painful and risky. By spawning the AI module in `dev` mode initially, students can safely perform checks, and the strict mode is only applied at the exact moment they commit to beginning the exam.

## Architecture Note: In-App Paper Viewer (Module 7B)
The question paper viewer explicitly renders PDFs (via Mozilla's `pdfjs-dist`) and DOCX files (via `mammoth`) directly inside an Electron `<canvas>`/`<div>`. We do **NOT** use `shell.openPath` or `shell.openExternal`.
Why? 
1. The strict Whitelist Enforcer would immediately terminate any external process (like Chrome, Edge, Acrobat, Word) as soon as it opens.
2. Even if we whitelisted those apps, allowing an external browser or Word processor opens a massive cheating vector (access to the internet, copy/paste, extensions, plugins), entirely defeating the purpose of the whitelist. Rendering entirely inside our isolated Chromium environment solves both problems.

## Architecture Note: App Check Filtering
During the self-check phase, listing raw running processes surfaced OS services, drivers, and antivirus components that students cannot and should not attempt to close. We enforce strict filtering by ignoring system accounts (`NT AUTHORITY\SYSTEM`, `LOCAL SERVICE`, etc.), enforcing that the process belongs to the logged-in user, and ignoring a `KNOWN_BACKGROUND_SERVICES` list for common false positives (e.g., `msmpeng.exe`, `securityhealthservice.exe`). This is a best-effort list, not exhaustive, and may need additions as more false positives are found during testing.

---

## How to Run

> **Note:** The backend server and dashboard must be running separately to see real results.

1. Navigate to the `electron` directory:
   ```bash
   cd candidate-app/electron
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` (if not already done) and configure ports if necessary.
4. Start the application:
   ```bash
   npm start
   ```

---

## Testing This Step

To verify the complete 4-step sequence (`consent → identity → self-check → exam`):
1. Start the **backend server** (`npm run dev` in `IntegrityFlow/server`).
2. Start the **dashboard** (`npm run dev` in `IntegrityFlow/dashboard`).
3. Start the **Electron app** (`npm start` in `IntegrityFlow/candidate-app/electron`).
4. **Step 1 — Exam Code Entry (`login.html`)**:
   - Enter an active Exam Code (e.g. `EXAM-101`) -> click **Enter Exam**.
   - Verify brief splash loading screen (*"Starting exam environment..."*) while the AI monitoring daemon spawns.
5. **Step 2 — Informed Consent Screen (`consent.html`)**:
   - Verify clear monitoring explanations and privacy commitments.
   - Check the required agreement checkbox -> click **"I Agree & Continue to Identification"**.
6. **Step 3 — Identity Capture (`identity.html`)**:
   - Enter **Full Name** (e.g., `Muhammad Ali`) and **Roll Number** (e.g., `FA20-BCS-042`).
   - Test validation: empty inputs or invalid characters trigger clear inline error banners.
   - Click **"Continue to System Check"**.
   - Inspect MongoDB: confirm a new `Session` document is created with `studentName: "Muhammad Ali"`, `rollNumber: "FA20-BCS-042"`, `studentId: "FA20-BCS-042"`, and `consentGiven: true`.
7. **Step 4 — System Self-Check (`selfCheck.html`)**:
   - Confirm the header badge renders `Candidate: Muhammad Ali (FA20-BCS-042) • Exam: EXAM-101`.
   - Run Camera, Mic, and App checks -> click **Begin Exam**.
8. **Step 5 — Exam Workspace & Dashboard Verification**:
   - In Candidate App: confirm the top bar displays `Student: Muhammad Ali (FA20-BCS-042)`.
   - In Dashboard `StudentList`: confirm the active candidate displays with primary name **Muhammad Ali**, secondary text **Roll: FA20-BCS-042 &bull; Exam: EXAM-101**, and session ID available in subtle tag/tooltip.
   - In Dashboard `EvidenceViewer`: confirm the header displays **Viewing: Muhammad Ali (FA20-BCS-042)**.
   - In Dashboard `ExamSummary` (after exam ends): confirm the candidate roster table and CSV export display student name and roll number.
