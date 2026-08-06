# Dashboard Documentation

## Project Context: What Are We Building & How?
**What we are building:** We are building the examiner dashboard for **IntegrityFlow**, an AI-powered exam proctoring system. This dashboard acts as the command center for human examiners. It allows them to monitor active exam sessions in real-time, view automated risk scores for each student, and review captured evidence of potential violations. 

**How we are building it:** The dashboard is built using **React** (bootstrapped via **Vite**). It connects to our Node.js backend using two methods:
1. **Axios (REST API)**: For fetching historical data, active sessions, and downloading exam papers.
2. **Socket.io (WebSockets)**: For maintaining a persistent connection to receive instant alerts when a violation occurs.

## UI Design Pass: Ops Dashboard Aesthetic
The dashboard features a specific "security control room" visual design:
- **Design Philosophy**: Rather than a standard web app or marketing page, it is styled as a highly functional, data-dense operations dashboard. The dark-mode base (`slate`) ensures the screen isn't fatiguing during long exams.
- **Functional Color System**: Colors are strictly reserved for status communication. Red, amber, and green are never used decoratively, guaranteeing that when a proctor sees color (e.g., a red risk badge or a left-border on an alert), it instantly conveys actionable meaning.
- **Typography & Hierarchy**: Technical IDs and numeric data use a monospace font (`Fira Code`) to contrast sharply with prose (`Inter`). The highest-risk students automatically float to the top of the `StudentList`, ensuring proctors do not have to hunt for issues. Evidence is laid out chronologically as a vertical timeline to clearly map the student's behavior over the exam session.

## What This Does
The dashboard provides a fully functional, live UI for examiners:
- **StudentList**: Fetches active sessions via REST API and displays them. It dynamically consumes live WebSocket events to color-code risk score badges per student.
- **AlertFeed**: Consumes live WebSocket events to create a scrolling feed of new violations across all students.
- **EvidenceViewer**: When a student is selected, it queries the REST API for their historical violations and renders evidence (including server-hosted screenshots).
- **PaperUploader (New)**: A dedicated tab that allows teachers to upload PDF/DOCX exam papers to the backend via a multipart form POST. This completely satisfies Module 7B (Teacher-side question paper distribution).

## How to Run
1. Ensure the **backend server** is running (`cd ../server && npm run dev`).
2. Navigate to the `dashboard/` directory: `cd IntegrityFlow/dashboard`
3. Install dependencies: `npm install`
4. Copy the environment variables example file: `cp .env.example .env`
5. Start the Vite development server: `npm run dev`
6. Open your browser to the local URL (usually `http://localhost:5173`).

## Files Changed/Added This Step
- `src/components/PaperUploader.jsx`: Clean React form utilizing `FormData` to upload files, handling validation (PDF/DOCX only) before sending to the server.
- `src/services/api.js`: Updated the `uploadPaper` Axios request to remove manual `Content-Type` headers so Axios handles `multipart/form-data` boundaries natively.
- `src/pages/Dashboard.jsx` & `Dashboard.css`: Added a clean tab navigation system to toggle between "Live Monitoring" and "Upload Exam Paper".
- `src/components/Components.css`: Styles for the uploader form and success/error states.

## Testing This Step
1. Go to the dashboard in your browser and click the "Upload Exam Paper" tab.
2. Enter an `examId` (e.g., "CS101").
3. Try uploading a `.txt` file — the frontend should instantly reject it with a red error.
4. Try uploading a `.pdf` file — click "Upload Paper". It will show "Uploading...", then a green success message.
5. Verify in your backend (or via MongoDB Compass) that the `Exam` document has been created and has a `paperPath` field.

## Project Status
**Dashboard MVP — COMPLETE.** 
All CORE modules (1-6) plus Module 7B teacher-side are successfully built! Module 5 (Scoring Engine) is accurately reflected via the RiskScoreBadge. 
*(Candidate app side for downloading the paper is the remaining piece for Person A).*
