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
  
- **Module 3: Evidence Capture (Screenshots)**
  - Automatically captures lightweight, compressed screenshots (<200KB) the moment a violation (like opening an unauthorized app) is detected.
  - Evidence is instantly uploaded to the backend and viewable in the teacher dashboard.

- **Module 4: Pre-Exam Self-Check**
  - A staging area before the exam begins that validates camera, microphone, and scans for currently running unauthorized background apps.
  - Safely transitions the AI module from relaxed `dev` mode to strict `exam` mode only when the student is ready.

- **Module 7B: Secure In-App Paper Viewer**
  - Question papers (PDF and DOCX) are fetched and rendered entirely inside the Electron app using `pdf.js` and `mammoth.js`.
  - Prevents the need to open external viewers (which would be immediately terminated by the Whitelist Enforcer and otherwise act as massive cheating vectors).

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
