# IntegrityFlow Canonical Contracts & Schemas

This document serves as the single source of truth for data contracts between the **Candidate Desktop App**, **Backend Server**, and **Examiner Dashboard**.

---

## 1. Violation Event JSON Schema (`POST /violation`)

```json
{
  "sessionId": "string (UUID / Session identifier)",
  "type": "head_turn_away | second_person_detected | no_face_detected | unauthorized_object | unauthorized_app | usb_device_detected | multiple_displays_detected | camera_occluded_or_dark",
  "severity": "number (1-5)",
  "timestamp": "ISO 8601 string (Microsecond precision preserved)",
  "details": {
    "confidence": "number, optional (0.00 - 1.00)",
    "duration": "number, optional (seconds)",
    "object_class": "string, optional (e.g. 'cell phone', 'book')",
    "process_name": "string, optional (e.g. 'chrome.exe')",
    "device_name": "string, optional (e.g. 'Drive E:\\ - Sandisk')",
    "display_count": "number, optional",
    "reason": "string, optional (e.g. 'Camera feed pitch dark or lens obstructed')",
    "direction": "string, optional (e.g. 'Looking Left', 'Looking Right', 'Desk Gaze')"
  },
  "screenshotPath": "string, optional (local or relative path to evidence snapshot)"
}
```

---

## 2. In-Exam Live Chat & Broadcast Message Schema (`POST /messages`)

```json
{
  "_id": "string (MongoDB ObjectId)",
  "sessionId": "string (Session ID for direct student query, or 'ALL' for broadcasts)",
  "examId": "string (Exam Code e.g. 'CS401-MID')",
  "sender": "'candidate' | 'teacher'",
  "senderName": "string (Full Name e.g. 'Muhammad Ali')",
  "rollNumber": "string (Roll Number e.g. 'FA20-BCS-042')",
  "studentId": "string, optional",
  "text": "string (Message text content)",
  "isBroadcast": "boolean (true if sent to all candidates in the exam)",
  "timestamp": "ISO 8601 string",
  "read": "boolean"
}
```

---

## 3. Candidate Session Creation Schema (`POST /sessions`)

```json
{
  "sessionId": "string (Client-generated UUID)",
  "examId": "string (Exam Code e.g. 'CS401-MID')",
  "studentName": "string, required (Candidate Full Name)",
  "rollNumber": "string, required (Institutional Roll/Reg Number)",
  "studentId": "string, optional",
  "consentGiven": "boolean (Must be true)",
  "cameraVerificationStatus": "'pending' | 'verified' | 'rejected' | 're_verify'",
  "status": "'active' | 'completed' | 'terminated'",
  "startTime": "ISO 8601 string",
  "endTime": "ISO 8601 string, optional",
  "totalDurationMinutes": "number, optional",
  "warnings": [
    {
      "message": "string",
      "timestamp": "ISO 8601 string",
      "examinerId": "string"
    }
  ]
}
```

---

## 4. Disk-Backed Offline Buffer SQLite Schema (`violationBuffer.js`)

```sql
CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_json TEXT NOT NULL,
  screenshot_path TEXT,
  original_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT
);
```

---

## 5. Camera Self-Check & Reverification Schema (`POST /sessions/:sessionId/camera-verification`)

```json
{
  "photoBase64": "string (data:image/jpeg;base64,...)",
  "isReverification": "boolean, optional"
}
```

---

## 6. Question Paper Waiting Lobby Protocol (`GET /exam/:examId/paper`)

* **HTTP `423 Locked`**: Paper has been uploaded by the examiner but has not yet been released. Candidate app displays the Waiting Lobby standby screen.
* **HTTP `200 OK`**: Paper is officially released. Response contains `{ paperUrl, fileName, mimeType }` for in-app rendering.
* **HTTP `404 Not Found`**: No paper uploaded for this exam code.
* **HTTP `403 Forbidden`**: Candidate session is not in an active status.
