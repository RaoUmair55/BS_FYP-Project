# IntegrityFlow

IntegrityFlow is an AI-powered, highly secure exam proctoring and monitoring system. It provides a strict, locked-down environment for candidates while giving teachers and examiners real-time oversight, evidence timelines, and automated risk scoring.

## Architecture

IntegrityFlow is composed of three main components:

1. **Candidate App (`/candidate-app`)**
   - An Electron-based secure desktop shell.
   - Bundles a Python-based AI Monitoring Module running locally to ensure high performance and privacy.
   - Responsible for hardware self-checks, strict process whitelist enforcement, and rendering exam papers securely without relying on external browsers.

2. **Backend Server (`/server`)**
   - A Node.js + Express REST API backed by MongoDB.
   - Manages sessions, processes violation evidence (screenshots), calculates dynamic risk scores, and handles exam paper distribution.

3. **Teacher Dashboard (`/dashboard`)**
   - A React + Vite web application for examiners.
   - Features a live Global Alert Feed, active session monitoring, and a detailed Evidence Timeline for reviewing captured screenshots and violations.

---

## Completed Modules & Features

- **Module 1: Whitelist Enforcement & Pre-Existing Notes Guard**
  - Actively polls running system processes and enforces a strict whitelist.
  - Includes standard dev/system utilities (`git-remote-https.exe`, `phoneexperiencehost.exe`, etc.) in whitelist configuration.
  - **Pre-Existing File Timestamp Guard**: Automatically monitors open file handles in teacher-allowed software (Word, VS Code, etc.) and flags files modified/created prior to the exam start time (`mtime < exam_start_time`).
  - Gracefully handles Dev vs. Exam modes, allowing developers to work safely without the AI module terminating their IDEs, while ruthlessly blocking cheating vectors during a real exam.

- **Module 2: AI Computer Vision Monitoring & Lens Defense**
  - Instant camera occlusion and dark feed detection (`camera_occluded_or_dark`) in 1.2s via photometric luminance and spatial variance checking.
  - Multi-signal head pose tracking: lateral yaw (`head_turn_away`), desk gaze, and upward pitch / above-screen gaze (`sustained_upward_seconds: 1.2s`) with neck-tilt continuity tracking.
  - Multiple face counting, missing face detection, and unauthorized object (cell phone, book) detection.
  - CPU-bounded execution (<5% load) with 2-thread ONNX clamping and C++ SIMD blob extraction.
  
- **Module 3: Evidence Capture (Screenshots)**
  - Automatically captures lightweight, compressed screenshots (<200KB) the moment a violation is detected.
  - Evidence is instantly uploaded to the backend and viewable in the teacher dashboard with strict per-examiner and per-candidate isolation.

- **Module 4: Pre-Exam Self-Check & Dual-Environment Support**
  - Staging area validating candidate camera, microphone, external storage drives, displays, and background apps.
  - **Dual-Mode Proctoring Architecture**:
    - 🌐 **Remote Online Mode**: Full AI Vision (Webcam), Eye Tracking, Microphone, and Environment Detection.
    - 🏫 **On-Campus Physical Lab Mode**: Bypasses camera/mic hardware checks (ideal for lab desktop towers without webcams), activating Shell Lockdown, USB Insertion Guard, and Process Whitelisting.
  - Enforces student identity capture (Full Name + Roll Number) and explicit informed consent.

- **Module 5: Dynamic Exponential Severity Decay Engine**
  - Mathematical risk scoring algorithm with a 15-minute half-life, ensuring transient single violations decay smoothly while repeated violations escalate student risk scores.

- **Module 6: Live Multi-Candidate Grid Gallery & Examiner Data Isolation**
  - Visual dashboard gallery with candidate reference photos, real-time risk gauge indicators (Green/Amber/Red), and 1-click proctoring tools (+5m/+10m exam extensions, direct evidence review).
  - Multi-tenant data isolation: Examiners strictly view and manage their own created exams, active candidate sessions, and evidence, while Administrators retain global department-wide oversight.

- **Module 7B: Secure In-App Paper Viewer, Workspace & Clipboard Lockdown**
  - Question papers (PDF/DOCX) rendered entirely inside Electron with dynamic anti-leak watermark overlays.
  - **OS Clipboard & Copy-Paste Lockdown**: Automatically flushes the OS clipboard on exam start and intercepts `copy`, `cut`, `paste`, context menu (right-click), and keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Shift+Insert`).
  - Supports auto-saved typed text answers and direct file submissions (.pdf, .docx, .zip, etc.).

- **Module 8: In-Exam Live Chat & Proctor Broadcasts**
  - Exam-scoped bidirectional communication allowing candidates to ask question paper clarifications and examiners to broadcast announcements or reply directly with zero cross-exam chat leakage.

- **Module 9: Disk-Backed Offline Buffering (SQLite / Atomic FIFO Queue)**
  - Crash-proof offline buffer preserving all violation payloads and screenshots during network outages, replaying events with original microsecond timestamps once connectivity resumes.

- **Module 10: Segmented Candidate Submission & Top-Tabbed Review Suite**
  - **3-Way Tabbed Candidate Drawer**: Cleanly segments candidate review into **📄 Final Submission**, **🛡️ Evidence Timeline**, and **📸 Camera & Identity** views.
  - **Typed Script & Document Viewer**: Displays candidate typed answer scripts with live word/character counts, instant clipboard copy (`Copy Answer`), and file download/preview cards for uploaded solution artifacts (.pdf, .docx, .zip).
  - **Pre-Exam Photo Verification**: Dedicated identity card displaying the pre-exam webcam snapshot, verified student credentials, and session metadata.

- **Module 11: Real-Time Exam Lifecycle, Auto-Expiry & Safeguards**
  - **Automated Duration Expiry Transition**: Exams automatically conclude and transition into historical archives when the designated duration expires without requiring manual teacher intervention.
  - **Dynamic Priority & Alert Counters**: Real-time calculated unreviewed violation count badges that dynamically synchronize with WebSocket updates.
  - **Pre-Exam AI Monitoring Suppression**: Whitelist enforcement and AI computer vision monitoring are strictly withheld during login and self-check, activating only after the student officially starts the exam.
  - **Pre-Existing Document Upload Guard**: Validates file creation and modification timestamps (`mtime`) on student uploads, blocking submissions of pre-existing solutions created prior to the exam start time.

---

## Setup & Running

> **Note:** For the full pipeline to work, start the Server and Dashboard before starting the Candidate App.

### 1. Server
```bash
cd server
npm install
# Ensure MongoDB is running and .env is configured
npm run dev
```

### 2. Dashboard
```bash
cd dashboard
npm install
npm run dev
```

### 3. Candidate App
```bash
cd candidate-app/electron
npm install
# To rebuild the renderer if you make UI changes: npm run build:renderer
npm start
```

## Team
- Placeholder (Add your team members here)
