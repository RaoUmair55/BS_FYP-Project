<!--
IntegrityFlow file overview
Purpose: Technical documentation for the candidate application.
How it works: Explains candidate setup, screens and monitoring behavior for development and presentation preparation.
Connection: Read alongside the source-file comments and FILE_GUIDE.md; this document is not executed.
-->
# Candidate App (Electron Shell)

The Candidate App is the desktop application run by students during an exam. It serves as a secure wrapper that bundles the user interface with our AI monitoring module.

## What This Does

This module implements the full end-to-end exam experience, AI monitoring pipeline, **Module 1: Whitelist Enforcement**, **Module 2: AI Monitoring**, **Module 7: File & Typed Text Submissions**, and **Section 10.4 of the Scope Document (Data Ethics & Informed Consent)**:
1. **Startup**: Electron starts a loopback receiver on an available port and passes that port to Python. Python also binds an available loopback port and announces it to Electron; neither service requires port 8000 or 8766.
2. **Dynamic Login & Session Initialization**: Candidate logs in with Student ID, Name, and Exam Code. Electron creates the session on the central server.
3. **Informed Consent Screen (Section 10.4 Data Ethics)**:
   - Before any self-check or monitoring begins, the student is presented with `consent.html` ("Before You Begin").
   - Explains camera orientation/multi-face checks, process monitoring, identity photos, event screenshots, and online-mode voice monitoring. Physical lab mode skips camera and voice monitoring.
   - Prominently clarifies our privacy commitments: **continuous video is NEVER recorded or stored in files/databases** (in-memory frame analysis only), and **no biometric facial profiling databases are created**.
   - Discloses session speaker-reference vectors saved locally and suspicious audio clips saved locally and uploaded to the configured evidence storage for examiner/admin review. Raw enrollment recordings are processed in memory rather than saved as enrollment audio files.
   - Discloses that there is no automatic expiry: retained profiles and evidence remain after the exam until an authorized operator manually removes the local and uploaded copies. Candidates can contact their examiner/coordinator about retention and removal.
   - Requires explicit checkbox agreement covering monitoring, voice-reference storage, evidence uploads, and retention. Electron and identity submission both reject missing or false consent. Run `npm run check:consent` from `electron/` to verify these gates.
   - "Continue to Identification" remains disabled until consent is checked.
   - Provides an explicit "Decline & Exit" option that gracefully exits the application.
4. **Identity Capture & Session Creation (`identity.html`)**:
   - Following consent, candidate provides **Full Name** (e.g., `Muhammad Ali`) and **Roll / Registration Number** (e.g., `FA20-BCS-042`).
   - Validates input format (non-empty, minimum length, valid institutional alphanumeric characters).
   - **Consolidated Session Creation**: Submits `POST /sessions` to create the MongoDB session with `studentName`, `rollNumber`, `studentId`, `examId`, and verified consent flags.
5. **AI Module Spawning & Dual-Mode Self-Check Flow (`selfCheck.html`)**:
   - Displays candidate identification badge.
   - **🌐 Remote Online Mode**: Runs 6 checks (Camera, Microphone, Voice Reference 8s enrollment + 4s confirmation, Background Process Whitelist, USB storage, and Multi-display).
   - **🏫 Physical Lab Mode**: Automatically bypasses camera and microphone hardware checks (ideal for lab PCs without webcams), requiring only Process Whitelist, USB, and Display checks.
   - Captures and uploads initial reference selfie and voice embedding (online mode only).
   - "Begin Exam" switches Python daemon into strict `exam` mode, triggers `isExamActive = true`, and opens the exam workspace.
6. **Whitelist, Pre-Existing File Guard, USB, Voice & AI Monitoring**: 
   - **Pre-Exam False-Alert Suppression**: During Login and Self-Check, AI monitoring and process whitelisting are intentionally silenced (`mode == 'dev'` / `isExamActive == false`) so students typing their names/credentials or opening background apps do not trigger spurious violation alerts. Full proctoring activates only upon entering the active exam room.
   - `WhitelistEnforcer` scans processes every 2.5s and incorporates a **Pre-Existing File Timestamp Guard**: when teacher-allowed external tools (Word, VS Code, Notepad) are permitted, it inspects open file handles and flags any files modified before exam start (`mtime < exam_start_time`).
   - `AIMonitor` tracks lateral head yaw, upward head pitch (looking up / above screen view with neck-tilt continuity tracking), missing faces, multi-person events, and unauthorized physical objects (bypassed in Physical Lab mode).
   - `VoiceMonitor` runs a two-stage acoustic pipeline (VAD gate + speaker verification) to flag unauthorized third-party speech (bypassed in Physical Lab mode).
   - `USBMonitor` detects removable mass storage media insertion, and Electron's `screen` monitor detects multi-display connections.
7. **Two-Panel Exam Workspace, Clipboard Lockdown & Upload Integrity Guard (Module 7B & Module 7)**:
   - **Header Bar**: Displays `Student: [Full Name] ([Roll Number])`, `Exam: [Exam Code]`, Status badge (`● Monitoring Active` or `● Lab Integrity Active`), running HH:MM:SS timer.
   - **OS Clipboard & Copy-Paste Lockdown**: Flushes OS clipboard upon exam start and intercepts `copy`, `cut`, `paste`, context menu (right-click), and keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Shift+Insert`), auto-clearing clipboard on attempt or window focus.
   - **Left Panel**: In-app paper viewer (rendering PDF/DOCX inside Electron without external viewers).
   - **Right Panel**: Answer area with tabs for (a) plain typed text with auto-saving to local storage, and (b) file attachment upload (.pdf, .docx, .py, .cpp, .zip).
   - **Pre-Existing Document Upload Prevention**: Validates selected file modification times against the exam session start time (`file.lastModified < examStartTime`), warning candidates and disarming uploads of pre-existing solution documents.
   - **Submission Flow**: Prominent "Submit Exam" button with confirmation modal, retryable network failure handling, and MongoDB persistence.
8. **Violation Detection & Screenshot Capture**: Captures screenshots (<200KB) with microsecond timestamps and forwards to central server (`unauthorized_app`, `unauthorized_object`, `cell_phone`, `head_turn_away`, `second_person_detected`, `second_voice_detected`, `no_face_detected`, `usb_device_detected`, `multiple_displays_detected`).
9. **Disk-Backed Offline Violation Buffer**: Electron uses an atomic JSON file in its userData directory; non-Electron runs may use SQLite. Failed writes are reported rather than acknowledged. A retry loop resends queued events with their original timestamps.

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
   - Windows USB storage monitoring uses PowerShell CIM `Win32_DiskDrive`, filtering USB disks with nonzero capacity. Each connected disk is reported once, with a new alert if it is disconnected and reconnected. Enumeration failures are surfaced as errors.
   
3. **Deliberate Design: Structural Exclusion of HID Devices (Mice/Keyboards)**:
   - **Critical Requirement**: Wired USB mice, keyboards, webcams, headsets, and barcode scanners must NEVER be flagged as violations.
   - **How this is solved**: Detection filters USB disk devices, excluding empty readers. Ordinary HID and audio/video peripherals are not disk devices.

## Reliability and presentation rehearsal

See [RELIABILITY.md](RELIABILITY.md) for startup safeguards, detector changes, limitations and the presentation checklist. Run `npm run check:reliability` from this directory before the demonstration. Online monitoring uses MediaPipe when available and OpenCV otherwise; fallback gaze uses a neutral-position baseline. Automated checks do not replace a real camera/microphone rehearsal.

---

## Architecture Note: Disk-Backed Offline Violation Buffering & Transport Resilience

### 1. Why Buffering Lives in the Electron IPC Layer (Separation of Concerns)
- **Zero Monitor Complexity**: The individual detection monitors (`AIMonitor`, `WhitelistEnforcer`, `USBMonitor`, `DisplayMonitor`, `VoiceMonitor`) are decoupled from network transport logic. Each monitor simply fires violation events to the local receiver.
- **Single Point of Resilience**: Network outages, server restarts, or transient WiFi drops are transport failures, not monitor failures. Centralizing offline persistence in the Electron IPC layer (`violationForwarder.js` / `pythonBridge.js`) ensures **every existing and future monitor inherits guaranteed offline delivery without modifying any detection code**.

### 2. Offline Buffer Storage
- **Concurrent Write Safety**: In high-stress scenarios (e.g., candidate simultaneously opens an unauthorized browser and plugs in a USB flash drive), multiple monitors dispatch events concurrently. A flat JSON file risks race conditions, corrupted partial writes, and read-after-write conflicts.
- **Electron persistence**: Electron uses an atomic JSON replacement in its `userData` directory. This is neither encrypted nor a SQLite WAL database; keep that limitation in mind when handling evidence.
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

## Architecture Note: Two-Stage Acoustic Pipeline (Smart Gating & CPU Efficiency)

### 1. Two-Stage Design: Lightweight VAD Gate + Deep Speaker Verification
Voice-based second-person detection operates as a strict two-stage pipeline:
- **Stage 1 — VAD Gate (Always-On, <1% CPU)**:
  - Continuously samples microphone audio in short **30ms frames** (480 samples @ 16kHz mono) and processes them through C-optimized **WebRTC VAD** (`webrtcvad.Vad(mode=2)`).
  - WebRTC VAD consumes negligible CPU (<0.5%) and tracks sustained speech frames over time.
  - If voice activity is detected continuously for more than **2.0 seconds** (`vad_sustained_seconds`), the audio segment is gated in and forwarded to Stage 2.
  - **Noise / Transient Filtering**: Brief sounds such as throat-clearing, coughs, desk taps, keyboard clicks, or single isolated words that do not sustain past the 2.0-second threshold are discarded immediately. Stage 2 never runs for these sounds.

- **Stage 2 — Speaker Verification (Gated Execution, Runs ONLY on Sustained Speech)**:
  - Invoked **only** when Stage 1 flags a sustained speech segment.
  - The segment is preprocessed into 16kHz float32 audio and passed to **Resemblyzer** (`VoiceEncoder(device='cpu')`) to extract a 256-dimensional speaker embedding vector.
  - The system computes the cosine similarity between the current segment's embedding vector and the candidate's reference voice embedding captured during the Self-Check phase:
    $$\text{Cosine Similarity} = \frac{\mathbf{e}_{\text{ref}} \cdot \mathbf{e}_{\text{seg}}}{\|\mathbf{e}_{\text{ref}}\| \|\mathbf{e}_{\text{seg}}\|}$$
  - **Thresholding & Consecutive Segment Debouncing**: If similarity falls below `0.75` (`voice_similarity_threshold`) for **2 or more consecutive gated segments** (`consecutive_mismatches_threshold`), a `second_voice_detected` (Severity 3) violation is emitted.
  - **Self-Speech Tolerance**: When the candidate speaks aloud to themselves (e.g. reading exam questions or murmuring calculations), Stage 2 matches their registered reference profile ($\text{similarity} \ge 0.75$), the consecutive mismatch counter resets to 0, and no violation is fired.

### 2. Theoretical Alignment: "Smart Sampling" Sensor Philosophy
This two-stage acoustic pipeline directly mirrors the same **"smart sampling" philosophy** already implemented in **Module 2's vision pipeline** (Section 9.4 of the scope document):
- In visual monitoring, lightweight frame differencing and Haar cascaded face anchors gate heavier neural inference (YOLO / MediaPipe Face Mesh).
- In acoustic monitoring, lightweight WebRTC VAD gates heavier neural speaker verification (Resemblyzer).
- **Result**: Applying cheap checks as gates to expensive checks ensures CPU usage remains strictly within the **<35% average budget** across all concurrent AI monitors (Webcam + Whitelist + USB + Voice + Display).

---

## Files Changed/Added

- `CONTRACT.md`: Added `second_voice_detected` (severity 3) and `similarity_score` / `duration_seconds` to violation event schema.
- `server/src/models/Violation.js`: Added `second_voice_detected` to mongoose violation enum.
- `ai-module/voice_monitor.py` (NEW): Two-stage voice monitor class with WebRTC VAD gating, Resemblyzer speaker verification, and embedding calibration.
- `ai-module/requirements.txt`: Added `webrtcvad-wheels>=2.0.10`, `resemblyzer>=0.1.4`, `sounddevice>=0.4.6`.
- `ai-module/config/thresholds.json`: Added `vad_sustained_seconds` (2.0), `voice_similarity_threshold` (0.75), `consecutive_mismatches_threshold` (2).
- `ai-module/server.py`: Added `POST /set-reference-voice` and `GET /check-voice` endpoints.
- `ai-module/main.py`: Initialized, injected, started, and stopped `VoiceMonitor` alongside `AIMonitor`, `WhitelistEnforcer`, and `USBMonitor`.
- `electron/main.js`: Added `set-reference-voice` and `check-voice` IPC handlers.
- `electron/preload.js`: Exposed `setReferenceVoice` and `checkVoice` to renderer `window.api`.
- `renderer/selfCheck.html`: Added 6-step self-check UI with Voice Reference Profile Check (`#check-voice`).
- `renderer/selfCheck.js`: Integrated 16kHz WAV audio recorder, 4-second countdown, and reference calibration with "Record Again" workflow.
- `CANDIDATE.md`: Documented two-stage acoustic architecture, viva rationale, testing guide, and known limitations.

---

## Testing This Step

To verify the complete security checks (`consent → identity → self-check (6 checks) → exam`):
1. Start the **backend server** (`npm run dev` in `IntegrityFlow/server`).
2. Start the **dashboard** (`npm run dev` in `IntegrityFlow/dashboard`).
3. Start the **Electron app** (`npm start` in `IntegrityFlow/candidate-app/electron`).

### Two-Stage Voice Verification Testing:
- [x] **1. Reference Voice Capture at Self-Check**:
  - In Self-Check, click "Record Voice Sample (4s)" on Step 3.
  - Read the prompt sentence aloud clearly (*"IntegrityFlow confirms my identity and verifies my voice for this examination session."*).
  - Confirm the countdown completes, the 256-d embedding is computed and saved, and a green checkmark appears.
  - Click "Record Again" to verify re-recording works smoothly.

- [x] **2. Student Self-Speech in Exam (True Negative)**:
  - Enter the active exam workspace and speak aloud normally alone (e.g. reading exam questions for 3-5 seconds).
  - Confirm **no violation fires** (Stage 2 verifies cosine similarity $\ge 0.75$ and matches your voice).

- [x] **3. Second Person Speaking Nearby (True Positive)**:
  - Have another person speak continuously for 2+ seconds nearby during the exam.
  - Confirm a `second_voice_detected` violation is emitted after 2 consecutive mismatched segments and displayed on the examiner dashboard.

- [x] **4. Transient Noise & Cough Filtering (Stage 1 VAD Gate Isolation)**:
  - Cough, sneeze, tap the desk, or utter single isolated words (<2.0s).
  - Check the Python console logs: confirm Stage 1 filters out these transient sounds before Stage 2 ever runs (Stage 2 Resemblyzer inference is not invoked).

- [x] **5. CPU Usage Profiling Under Sustained Speech**:
  - Compare CPU metrics reported every 30s by `monitor_cpu_budget()`:
    - Stage 1 VAD running alone (ambient background / silence): **< 1% process CPU**.
    - Stage 1 + Stage 2 active during sustained third-party speech: **brief ~8-14% burst** during 1-second embedding extraction, returning immediately to base.
    - Overall AI monitor suite average stays comfortably within the **< 35% CPU target**.

---

## Known Limitations & Future Work

- **Live vs. Recorded Audio Distinction**: The speaker verification system evaluates acoustic vocal tract characteristics against the reference embedding. It distinguishes *different speakers*, but cannot distinguish between a live second person in the room versus recorded third-party audio played aloud through a speaker (e.g., a phone call on speakerphone or a synthesized text-to-speech engine). Acoustic replay spoofing detection (e.g., high-frequency speaker artifact analysis) is identified as future work.

## Durable monitoring and file-policy update

Python now persists alerts before local handoff; Electron persists before acknowledging and sends evidence asynchronously. Failed handoffs survive Python restarts using the same capture timestamp and event ID. See `RELIABILITY.md` for spool location and recovery behavior.

Old-file detection remains enabled. Teacher-approved exact candidate-PC paths arrive through exam `rules.permittedFiles`; other old documents are still detected. Enforcement closes only a verified owning process. Uncertain observations are reported for review, and notices preserve unrelated answer attachments. New answer-upload restrictions remain active. Voice quality/reconnection, object letterboxing/tracking, bright camera covers and UASP USB detection have dedicated regression coverage; real-device rehearsal is still required.
