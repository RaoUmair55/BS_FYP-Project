# IntegrityFlow: A Decentralized Edge-AI and OS-Level Security Architecture for Automated Exam Proctoring

> **Final Year Project — Phase 1 Technical Progress & Implementation Defense**  
> **Academic Session:** 2026–2027  
> **Target Duration:** 15–20 Minutes (5–6 Min Presentation + 7–8 Min Live Demo + Q&A)

---

## 📑 Presentation Table of Contents

- **Slide 1:** Title & Academic Metadata
- **Slide 2:** Problem Formulation & Digital Proctoring Threat Vectors
- **Slide 3:** Project Scope & Core Engineering Objectives
- **Slide 4:** System Architecture & Data Flow Diagram
- **Slide 5:** Edge-AI Pipelines: Real-Time Vision & Two-Stage Acoustic Monitoring
- **Slide 6:** OS-Level Lockdown, Process Watchdog & Peripheral Management
- **Slide 7:** Current Implementation Progress (~78% Complete — Defensible Breakdown)
- **Slide 8:** Work Completed vs. Final Phase Roadmap
- **Slide 9:** 4-Stage Live Demonstration Flow
- **Slide 10:** Summary, Technical Lessons Learned & References

---

## Slide 1: Title & Academic Metadata

### 🏷️ Header & Subtitle
* **Title:** **IntegrityFlow: A Decentralized Edge-AI and OS-Level Security Architecture for Automated Exam Proctoring**
* **Subtitle:** Final Year Project — Phase 1 Technical Progress & Implementation Defense

### 📋 Metadata Fields
* **Investigators / Team Members:**
  * [Student 1 Name — Roll / Registration No.]
  * [Student 2 Name — Roll / Registration No.]
  * [Student 3 Name — Roll / Registration No.]
* **Principal Project Supervisor:** [Supervisor Name, Designation & Department]
* **Department:** Department of Computer Science / Software Engineering
* **Institution:** [University / Institute Name]
* **Date:** October 2026

---

## Slide 2: Problem Formulation & Threat Vectors

### 🚨 Real-World Cheating Vectors in Digital Examinations
1. **Bandwidth & Compute Bottlenecks:** Streaming 50+ raw candidate video streams to cloud servers requires heavy outbound bandwidth ($\ge 2.5\text{ Mbps/student}$) and causes server-side processing bottlenecks.
2. **Peripheral & Multi-Display Exploits:** Students leverage secondary unmonitored HDMI displays, unauthorized background software (browser tabs, cheat notes), and USB flash drives.
3. **Acoustic Noise vs. True Assistance:** Simple decibel-threshold monitors fail because they flag mechanical typing noise, room fans, and coughing as cheating.
4. **Network Dropouts:** Temporary Wi-Fi disconnects in standard web proctoring cause irrecoverable loss of violation logs and candidate status.

### 📊 Threat Taxonomy Matrix

```
+-----------------------------------------------------------------------------------+
|                              EXAM THREAT TAXONOMY                                |
+-------------------------+--------------------------------+------------------------+
|    VISUAL CHEATING      |       ACOUSTIC CHEATING        |    SYSTEM/HARDWARE     |
+-------------------------+--------------------------------+------------------------+
| • Persistent Gaze Turn  | • Unregistered Co-Speaker      | • Secondary Display    |
| • Multiple Faces in View| • Covert Whispers/Assistance   | • Unauthorized Process |
| • Candidate Absence     | • Mechanical Audio Noise       | • USB Mass Storage     |
| • Mobile Phone / Notes  |   (Keyboards / Fan Hum)        | • Wi-Fi Disconnection  |
+-------------------------+--------------------------------+------------------------+
```

---

## Slide 3: Project Scope & Core Engineering Objectives

### 🎯 Primary Project Deliverables
1. **Decentralized Client-Side AI Inference:** Run facial mesh tracking, head pose estimation, and YOLO object inference locally on the candidate workstation ($< 15\%\text{ CPU}$, $\ge 25\text{ FPS}$).
2. **Two-Stage Acoustic Monitoring:** Filter mechanical noises (typing, fan hum) via WebRTC VAD Mode 2 before invoking Resemblyzer d-vector voice embedding verification for secondary speakers.
3. **Deterministic OS-Level Lockdown:** Leverage Electron kiosk mode, native Windows CIM/WMI queries for USB blocking, and continuous `psutil` process enforcement against unauthorized applications.
4. **Resilient Offline Failover:** Buffer violations in an asynchronous local SQLite database during network dropouts and automatically sync to the server upon reconnection.
5. **Real-Time Proctoring Dashboard:** Full-duplex Socket.io event broadcasting for live candidate status, violation evidence (snapshots & audio), and two-way proctor warning messages.

---

## Slide 4: System Architecture & Component Diagram

### 🏗️ Architectural Topology

```mermaid
graph TD
    subgraph Client_Workstation ["Candidate Workstation"]
        subgraph Electron_App ["Electron Desktop App (Kiosk Shell)"]
            Renderer["Renderer UI (HTML5 / Vanilla JS)"]
            IPC["Electron Main Process & Kiosk Enforcer"]
            SQLiteBuffer["Local SQLite Offline Buffer"]
        end
        
        subgraph Python_AI ["Python Edge AI Module (FastAPI Localhost:8766)"]
            Vision["Vision Engine (MediaPipe Face Mesh + YOLO ONNX)"]
            Audio["Voice Monitor (WebRTC VAD + Resemblyzer)"]
            USBCIM["USB Watchdog (PowerShell CIM Query)"]
        end
    end

    subgraph Central_Server ["Central Backend & Proctor Dashboard"]
        NodeServer["Node.js / Express Server & Socket.io Gateway"]
        MongoDB[(MongoDB Database & Media Storage)]
        Dashboard["Teacher Dashboard (React + Vite)"]
    end

    Renderer <-->|IPC| IPC
    IPC <-->|HTTP REST :8766| Python_AI
    IPC -->|WebSocket / HTTPS| NodeServer
    IPC -.->|On Disconnect| SQLiteBuffer
    SQLiteBuffer -.->|On Reconnect Sync| NodeServer
    NodeServer <-->|Mongoose| MongoDB
    NodeServer <-->|Socket.io Real-Time Events| Dashboard
```

---

## Slide 5: Edge-AI Pipelines: Real-Time Vision & Voice Verification

### 👁️ 1. Vision Analysis Pipeline
* **Facial Landmarks & Head Pose:** 468-point 3D landmark mesh via MediaPipe. Head pose computed using Perspective-n-Point (PnP) solver to calculate **Yaw**, **Pitch**, and **Roll**.
* **Temporal Violation Gating:** Gaze deviations ($\pm 28^\circ\text{ Yaw}$, $\pm 20^\circ\text{ Pitch}$) must persist for $\ge 2.5\text{s}$ to prevent false positives from normal blinking or quick eye movement.
* **Prohibited Objects:** Lightweight YOLO / MobileNet ONNX runtime detects mobile phones and notes in real-time.

### 🎙️ 2. Two-Stage Acoustic Neural Pipeline

```
[Microphone Audio (16kHz Mono)] 
               │
               ▼
┌──────────────────────────────────────┐
│  STAGE 1: WebRTC VAD (Mode 2)        │  Lightweight (< 1% CPU)
│  • Frames: 30ms (480 samples)        │
│  • Filters out: Typing clicks, fans  │
│  • Condition: Speech sustained > 2.0s│
└──────────────────┬───────────────────┘
                   │ (Gated In: Sustained Speech)
                   ▼
┌──────────────────────────────────────┐
│  STAGE 2: Resemblyzer d-Vector Model │  Speaker Verification
│  • Extracts 256-d voice embedding    │
│  • Computes Cosine Similarity vs.    │
│    Pre-Exam Enrolled Voice Profile   │
│  • Flags violation if cos(θ) < 0.75  │
└──────────────────────────────────────┘
```

---

## Slide 6: OS-Level Lockdown, Process Watchdog & Peripheral Guard

### 🔒 Three-Layer Host Machine Protection
1. **Desktop Kiosk & Window Management:**
   * Electron full-screen lockdown suppressing standard shortcut navigation.
   * Multi-monitor topology check: Blocks exam entry if physical or virtual secondary monitors ($\text{Count} > 1$) are detected.
2. **Process Watchdog & System Driver Whitelisting:**
   * Polling via `psutil` matches active processes against approved exam tools (e.g., Notepad, VS Code) while terminating unapproved applications.
   * Whitelist bypass for essential audio/graphics drivers (`RtkNGUI64.exe`, `WavesSvc64.exe`, `IGCC.exe`) to prevent system crashes.
3. **USB Flash Drive Interception via Windows CIM:**
   * Uses PowerShell CIM query (`Get-CimInstance Win32_DiskDrive WHERE InterfaceType='USB'`).
   * Eliminates empty card reader phantom hangs while detecting physical USB thumb drives in $< 1.2\text{s}$.

---

## Slide 7: Current Implementation Progress (~78% Complete)

### 📊 Honest, Defensible Module Status Breakdown

| Module / Subsystem | Implementation Details | Status | Completion % |
| :--- | :--- | :---: | :---: |
| **Kiosk & Multi-Screen Block** | Electron full-screen lockdown, multi-monitor check | Complete & Tested | **100%** |
| **System Self-Check & Enrollment** | Camera, mic, ping, dual voice baseline recording | Complete & Functional | **100%** |
| **Vision AI (Face & Objects)** | MediaPipe 468-pt mesh, head pose, YOLO phone detection | Functional & Live | **90%** |
| **Voice AI & Noise Filtering** | WebRTC VAD gating + Resemblyzer speaker verification | Functional & Calibrated| **85%** |
| **Process Watchdog & USB CIM** | Win32 CIM query, driver whitelist, app enforcer | Complete & Tested | **100%** |
| **Teacher Monitoring Dashboard** | Real-time candidate cards, alert stream, 2-way chat | Complete & Connected | **90%** |
| **Offline SQLite Sync Buffer** | Local queue with background retry loop | Complete & Tested | **100%** |
| **Post-Exam PDF Audit Reports** | Institutional report generator & credibility score | Phase 2 Milestone | **0%** |
| **TOTAL COMPLETION RATE** | **Line-by-line defensible progress** | **EXCEEDS >70%** | **~78.0%** |

---

## Slide 8: Work Completed vs. Final Phase Roadmap

### ✅ Work Completed in Phase 1 (~78%):
* End-to-end integration: `Candidate App` $\leftrightarrow$ `Python AI Engine` $\leftrightarrow$ `Node Server` $\leftrightarrow$ `Teacher Dashboard`.
* Real-time multi-modal violation detection (Gaze, Multiple Faces, Phones, Secondary Voice, USB Drives, Unauthorized Apps).
* Real-time proctor alert feed with evidence snapshots and 5-second `.wav` audio recordings.
* Two-way proctor intervention chat and broadcast announcements over WebSockets.
* Offline data safety via local SQLite buffer.

### 🔄 Remaining Work for Phase 2 (Final ~22%):
1. **Automated Institutional PDF Audit Reports:** Generating structured exam summary reports with student credibility scores and violation charts.
2. **Environmental Edge-Case Tuning:** Auto-adapting face detection under extreme low-light and high backlighting conditions.
3. **Expanded Load & Stress Benchmarking:** Stress-testing WebSocket throughput with automated synthetic client sessions.

---

## Slide 9: 4-Stage Live Demonstration Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. EXAM SETUP   │ ──► │ 2. SELF-CHECK   │ ──► │ 3. LIVE EVENTS  │ ──► │ 4. PROCTOR VIEW │
│ Teacher config  │     │ Camera, Mic &   │     │ Trigger Gaze &  │     │ Live alerts,    │
│ & allowed apps  │     │ 2-Step Voice    │     │ Process alert   │     │ Evidence snapshot│
│ on Dashboard.   │     │ Enrollment.     │     │ on Candidate PC.│     │ & Warning chat. │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **Step 1: Exam Configuration (Dashboard):** Show active exam with configured Allowed Applications (Notepad / VS Code).
2. **Step 2: Candidate Self-Check:** Candidate undergoes hardware self-check and dual-utterance voice calibration.
3. **Step 3: Trigger Live Violations:** Candidate turns head away ($\ge 2.5\text{s}$) and opens an unapproved background process.
4. **Step 4: Supervisor Live Stream & 2-Way Chat:** Dashboard receives instant socket alert with photo snapshot and sends a live warning message back to candidate screen.

---

## Slide 10: Summary & Academic References

### 💡 Key Takeaways
* **IntegrityFlow** demonstrates a practical, low-latency, client-side proctoring architecture that eliminates costly cloud GPU dependencies while securing the candidate environment.
* The system is **~78% complete**, exceeds the required 70% project threshold, and is fully functional for live demonstration.

### 📚 References
1. *Lugaresi, C. et al. (2019).* "MediaPipe: A Framework for Building Perception Pipelines." *arXiv preprint arXiv:1906.08172*.
2. *Wan, L. et al. (2018).* "Generalized End-to-End Loss for Speaker Verification." *IEEE ICASSP 2018*.
3. *Redmon, J. & Farhadi, A.* "YOLOv8: Real-Time Object Detection Framework." *ONNX Runtime Community Guidelines*.
4. *Microsoft Developer Network (MSDN).* "Windows Management Instrumentation (WMI) & CIM Win32 Process Security Reference."
