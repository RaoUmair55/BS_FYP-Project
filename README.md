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

- **Module 1: Whitelist Enforcement**
  - Actively polls running system processes and enforces a strict whitelist.
  - Gracefully handles Dev vs. Exam modes, allowing developers to work safely without the AI module terminating their IDEs, while ruthlessly blocking cheating vectors during a real exam.

- **Module 2: AI Computer Vision Monitoring & Lens Defense**
  - Instant camera occlusion and dark feed detection (`camera_occluded_or_dark`) in 1.2s via photometric luminance and spatial variance checking.
  - High-accuracy head pose yaw, desk gaze, multiple face counting, and unauthorized object (cell phone, book) detection.
  - CPU-bounded execution (<5% load) with 2-thread ONNX clamping and C++ SIMD blob extraction.
  
- **Module 3: Evidence Capture (Screenshots)**
  - Automatically captures lightweight, compressed screenshots (<200KB) the moment a violation is detected.
  - Evidence is instantly uploaded to the backend and viewable in the teacher dashboard.

- **Module 4: Pre-Exam Self-Check & Identity Verification**
  - Staging area validating candidate camera, microphone, external storage drives, displays, and background apps.
  - Enforces student identity capture (Full Name + Roll Number) and explicit informed consent.

- **Module 5: Dynamic Exponential Severity Decay Engine**
  - Mathematical risk scoring algorithm with a 15-minute half-life, ensuring transient single violations decay smoothly while repeated violations escalate student risk scores.

- **Module 6: Live Multi-Candidate Grid Gallery**
  - Visual dashboard gallery with candidate reference photos, real-time risk gauge indicators (Green/Amber/Red), and 1-click proctoring tools (+5m/+10m exam extensions, direct evidence review).

- **Module 7B: Secure In-App Paper Viewer & Answer Workspace**
  - Question papers (PDF/DOCX) rendered entirely inside Electron with dynamic anti-leak watermark overlays.
  - Supports auto-saved typed text answers and direct file submissions (.pdf, .docx, .zip, etc.).

- **Module 8: In-Exam Live Chat & Proctor Broadcasts**
  - Zoom/Meet-style bidirectional communication allowing candidates to ask question paper clarifications and examiners to broadcast global alerts or reply directly.

- **Module 9: Disk-Backed Offline Buffering (SQLite FIFO Queue)**
  - Crash-proof offline buffer preserving all violation payloads and screenshots during network outages, replaying events with original microsecond timestamps once connectivity resumes.

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
