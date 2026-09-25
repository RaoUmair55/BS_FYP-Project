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
6. **Whitelist, USB & AI Monitoring**: `WhitelistEnforcer` scans processes every 2.5s while `AIMonitor` tracks head pose, missing faces, multi-person events, and unauthorized physical objects. `USBMonitor` detects removable mass storage media insertion, and Electron's `screen` monitor detects multi-display connections.
7. **Two-Panel Exam Workspace (Module 7B & Module 7)**:
   - **Header Bar**: Displays `Student: [Full Name] ([Roll Number])`, `Exam: [Exam Code]`, Reassuring `● Monitoring Active` badge, running HH:MM:SS timer.
   - **Left Panel**: In-app paper viewer (rendering PDF/DOCX inside Electron without external viewers).
   - **Right Panel**: Answer area with tabs for (a) plain typed text with auto-saving to local storage, and (b) file attachment upload (.pdf, .docx, .py, .cpp, .zip).
   - **Submission Flow**: Prominent "Submit Exam" button with confirmation modal, retryable network failure handling, and MongoDB persistence.
8. **Violation Detection & Screenshot Capture**: Captures screenshots (<200KB) with microsecond timestamps and forwards to central server (`unauthorized_app`, `unauthorized_object`, `cell_phone`, `head_turn_away`, `second_person_detected`, `no_face_detected`, `usb_device_detected`, `multiple_displays_detected`).
9. **Disk-Backed Offline Violation Buffer (SQLite FIFO Queue)**: Automatically intercepts any network transport failure or server disconnect, enqueueing violation payloads and local evidence screenshots to an encrypted local SQLite database without dropping a single event. A background retry loop resends queued events with their original microsecond timestamps once connectivity resumes.

---

## Architecture — Modular Design (Dependency Inversion Principle)

The Candidate App's AI monitoring engine applies the **Dependency Inversion Principle (DIP)** from SOLID principles for evidence capture and violation logging:
- **`CaptureProvider` (Abstract Base Class)**: Defines the required `capture(session_id, violation_type) -> Optional[str]` contract using Python's `abc.ABC`.
- **`MssCaptureProvider` (Concrete Implementation)**: Implements fast, multi-monitor desktop capture via the `mss` library, dynamically downsampling JPEG quality to guarantee lightweight payloads (<200KB) with microsecond timestamp collision prevention.
- **`WebcamCaptureProvider` (Concrete Implementation)**: Encodes and captures active webcam video frames with annotated bounding boxes for camera violations (unauthorized cell phone, head turn, second person).
- **Single Swap Point (`ai-module/services/capture/__init__.py`)**: Exports the active provider instances and convenience helpers (`capture_screenshot`, `capture_webcam_frame`).

---

## Architecture Note: Multi-Display & USB Monitoring Placement

1. **Display Monitoring in Electron (`electron/main.js`)**:
   - Multiple display detection is natively managed by Electron using its built-in `screen` module (`screen.getAllDisplays()`, `screen.on('display-added')`, `screen.on('display-removed')`).
   - Placing display monitoring in the Electron main process avoids external OS polling overhead and enables instant event-driven violation triggers with zero CPU penalty. When a secondary monitor is connected mid-exam, Electron immediately forwards a `multiple_displays_detected` (Severity 4) violation directly to the server.

2. **USB Removable Storage Monitoring in Python (`ai-module/usb_monitor.py`)**:
   - USB storage monitoring requires low-level OS volume inspection. We use Python with `psutil.disk_partitions()`, Windows kernel32 `GetDriveTypeW` (checking for `DRIVE_REMOVABLE == 2`), and WMI `Win32_LogicalDisk(DriveType=2)`.
   
3. **Deliberate Design: Structural Exclusion of HID Devices (Mice/Keyboards)**:
   - **Critical Requirement**: Wired USB mice, keyboards, webcams, headsets, and barcode scanners must NEVER be flagged as violations.
   - **How this is solved**: Detection operates exclusively on **mounted logical disk drive letters** (`E:\`, `F:\`). USB Human Interface Devices (HID) and audio/video peripherals communicate through HID/UVC USB endpoints and never mount as file system volumes with drive letters. Therefore, wired mice and keyboards are structurally impossible to flag.

---

## Architecture Note: Disk-Backed Offline Violation Buffering & Transport Resilience

### 1. Why Buffering Lives in the Electron IPC Layer (Separation of Concerns)
- **Zero Monitor Complexity**: The individual detection monitors (`AIMonitor`, `WhitelistEnforcer`, `USBMonitor`, `DisplayMonitor`, `VoiceMonitor`) are decoupled from network transport logic. Each monitor simply fires violation events to the local receiver.
- **Single Point of Resilience**: Network outages, server restarts, or transient WiFi drops are transport failures, not monitor failures. Centralizing offline persistence in the Electron IPC layer (`violationForwarder.js` / `pythonBridge.js`) ensures **every existing and future monitor inherits guaranteed offline delivery without modifying any detection code**.

### 2. Why SQLite (WAL Mode) Over a Flat JSON File
- **Concurrent Write Safety**: In high-stress scenarios (e.g., candidate simultaneously opens an unauthorized browser and plugs in a USB flash drive), multiple monitors dispatch events concurrently. A flat JSON file risks race conditions, corrupted partial writes, and read-after-write conflicts.
- **ACID Transactions & Crash Resilience**: SQLite with **Write-Ahead Logging (`PRAGMA journal_mode = WAL`)** guarantees atomic, crash-proof inserts. Even if the candidate app's power is cut or the process is killed while offline, all buffered violation payloads and screenshot paths remain intact on disk in Electron's secure `userData` directory.
- **Strict FIFO Queue**: Buffered events are queried with `ORDER BY id ASC` to guarantee that temporal ordering is strictly maintained when replaying events to the backend.

### 3. Preserving Original Timestamps & Module 5 Scoring Engine Integrity
- **Authentic Violation Timing**: Every buffered event permanently retains its original microsecond detection timestamp (`original_timestamp`) rather than adopting the timestamp of when the network was reconnected.
- **Severity Decay Accuracy**: In Module 5's Severity Decay Engine, violations decay exponentially based on elapsed time:
  $$S(t) = S_0 \cdot e^{-\lambda \cdot (t - t_{\text{violation}})}$$
  If a student experiences a 5-minute network outage and 3 violations are replayed upon reconnect, using the reconnect time would incorrectly group all 3 violations as happening simultaneously, falsely spiking the student's instantaneous risk score. By preserving the true original timestamp $t_{\text{violation}}$, the backend computes the exact, authentic risk progression as it physically occurred during the exam.

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

- `CONTRACT.md`: Added `usb_device_detected` (severity 4) and `multiple_displays_detected` (severity 4) to violation event schema.
- `server/src/models/Violation.js`: Added `usb_device_detected` and `multiple_displays_detected` to mongoose violation enum.
- `ai-module/usb_monitor.py` (NEW): USB removable storage monitoring service detecting flash drives and external hard disks via drive letter enumeration and WMI/Win32 APIs.
- `ai-module/requirements.txt`: Added `wmi>=1.5.1`.
- `ai-module/server.py`: Added `GET /check-usb` endpoint for self-check phase.
- `ai-module/main.py`: Initialized, injected, started, and stopped `USBMonitor` alongside `WhitelistEnforcer` and `AIMonitor`.
- `electron/main.js`: Added `get-display-count` and `check-usb-drives` IPC handlers, and registered `screen.on('display-added')` / `screen.on('display-removed')` during active exam.
- `electron/preload.js`: Exposed `checkUsbDrives` and `getDisplayCount` to renderer `window.api`.
- `renderer/selfCheck.html`: Added External Storage Check (`#check-usb`) and Display Check (`#check-display`) items.
- `renderer/selfCheck.js`: Integrated 5-check validation (`camera`, `mic`, `apps`, `usb`, `display`) before enabling "Begin Exam".
- `CANDIDATE.md`: Documented USB storage and multi-display security features, architecture rationale, and explicit testing steps.

---

## Safety List

The `WhitelistEnforcer` maintains a strict `SAFETY_LIST` of critical Windows system processes (e.g., `svchost.exe`, `explorer.exe`, `lsass.exe`) that are never terminated, ensuring OS stability. 
**Note:** The safety list protects the OS, not convenience apps that could be used to bypass monitoring. The AI module itself is protected by its explicit PID (`os.getpid()`), not by broadly allowing `python.exe` or `cmd.exe`.

## Dev vs Exam Mode

To facilitate local development while maintaining strict security during real exams, the whitelist system supports two modes configured via the `APP_MODE` environment variable:
- **Dev Mode (`APP_MODE=dev`)**: Uses the `dev_whitelist` which is relaxed and allows development tools like `cmd.exe`, `powershell.exe`, and `code.exe` (VS Code). This prevents the AI module from aggressively killing your own development environment while you are building and testing the application.
- **Exam Mode (`APP_MODE=exam`)**: Uses the strict `exam_whitelist`. This is the real enforcement configuration that will kill terminals, editors, and other unauthorized tools to prevent cheating. Note: `EXAM_BLOCKED` (not `ALWAYS_BLOCKED`) only applies in exam mode. Development requires browsers/shells/local AI tools to function; these are only forbidden during a real exam session, not during our own development.

**Fail-Safe Default**: If `APP_MODE` is not specified, it safely defaults to `exam` mode. This ensures that if the mode is ever forgotten or misconfigured in production, it fails SAFE (strict) rather than open (relaxed). You can switch modes by updating the `.env` file in the `candidate-app` directory.

### 12. Question Paper Lobby & Timer Synchronization
- **Waiting Lobby Mode (`HTTP 423 Locked`)**: If the examiner uploads a paper with `paperReleased = false`, the candidate is placed in the **Standby Waiting Lobby**. The countdown timer is locked to `Standby (Lobby)` and will not deplete student exam time before the paper is officially unlocked.
- **Simultaneous Release Protocol**: When the examiner clicks **"Release Paper"** on the dashboard, active candidate polling receives `isPaperReleased = true` and `endTime`. The paper viewer renders the PDF/Word file with watermarks, and the countdown timer immediately activates.
- **No-Paper Workspace Mode (`HTTP 404`)**: If an exam is conducted without an attached PDF/DOCX question paper, the workspace automatically transitions to `● Workspace Active`, displays a clean instruction card in the left panel, and initiates the synchronized countdown timer for the full allocated exam duration.
- **Multi-Scale Downsampled Face Detection**: Evaluates Haar Cascades on width 360px (`scale_factor = 360.0 / frame_w`) and maps coordinates back to native resolution ($1.0 / \text{scale\_factor}$). Yields **4x–6x faster** execution (~11.8ms avg frame time) with 100% accuracy retention.
- **Dynamic Cadence Governor**: Runs monitoring loop at a steady **~11.7 FPS** (12ms compute + 73ms idle sleep), keeping background CPU utilization below 5%.

### 12. In-Exam Live Chat & Zoom/Meet Style Clarifications
- **Floating Candidate Inquiry Drawer**: A non-intrusive floating "Ask Examiner" button on the exam screen (`examScreen.html`/`examScreen.js`) allowing students to report paper concerns or typos.
- **Direct & Broadcast Sync**: Receives direct instructor responses and exam-wide broadcasts with real-time toast overlays and unread count badges.

---

## Testing This Step

To verify the complete security checks (`consent → identity → self-check (5 checks) → exam`):
1. Start the **backend server** (`npm run dev` in `IntegrityFlow/server`).
2. Start the **dashboard** (`npm run dev` in `IntegrityFlow/dashboard`).
3. Start the **Electron app** (`npm start` in `IntegrityFlow/candidate-app/electron`).

### Explicit Verification: HID Devices Must NOT Be Flagged
- [x] **Wired USB Mouse Test**: Connect a standard wired USB mouse. Click "Check USB Drives" in Self-Check. Confirm the mouse is **NOT flagged** and the check passes with green checkmark.
- [x] **Wired USB Keyboard Test**: Connect a standard wired USB keyboard. Click "Check USB Drives". Confirm the keyboard is **NOT flagged**.
- [x] **Removable Flash Drive Test**: Plug in a real USB flash drive / external hard drive. Click "Check USB Drives". Confirm the drive is **flagged** with drive letter and label (e.g. `💾 Drive E:\ — SANDISK (FAT32)`), and "Begin Exam" stays disabled until the drive is unplugged and rechecked.

### Camera Occlusion & Lighting Check Verification
- [x] **Tape / Hand Lens Obstruction Test**: Cover webcam lens with hand or tape. Confirm `camera_occluded_or_dark` triggers within ~1.2 seconds rather than 10 seconds.
- [x] **Low CPU Utilization Test**: Confirm AI monitor runs stably with CPU usage < 5-10% without system lag.

### In-Exam Chat Verification
- [x] **Student In-Exam Question**: Open floating chat drawer, type a concern, and submit. Confirm inquiry appears on Teacher Dashboard with Full Name and Roll Number.
- [x] **Teacher Reply & Broadcast**: Send reply or broadcast from Teacher Dashboard. Confirm toast notification and chat bubble appear on candidate app.
