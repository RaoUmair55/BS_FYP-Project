# IntegrityFlow Canonical Contracts & Schemas

This document serves as the single source of truth for data contracts between the **Candidate Desktop App**, **Backend Server**, and **Examiner Dashboard**.

---

## 1. Violation Event JSON Schema (`POST /violation`)

```json
{
  "sessionId": "string (MongoDB Session ObjectId)",
  "eventId": "string, optional (1-128 letters/digits/underscore/hyphen; stable across retries)",
  "type": "head_turn_away | second_person_detected | second_voice_detected | no_face_detected | unauthorized_object | unauthorized_app | usb_device_detected | multiple_displays_detected | camera_occluded_or_dark | secondary_camera_disconnected | secondary_camera_moved | secondary_camera_obstructed",
  "source": "front_camera | side_camera (default front_camera)",
  "severity": "number (1-5)",
  "timestamp": "ISO 8601 string with timezone (original capture time; stored at millisecond precision)",
  "details": {
    "confidence": "number, optional (0.00 - 1.00)",
    "similarity_score": "number, optional (0.00 - 1.00 for voice similarity)",
    "duration": "number, optional (seconds)",
    "duration_seconds": "number, optional (seconds)",
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

Evidence captured within the session start/end window may arrive after completion or termination. The response adds `receivedAt` and `receivedLate`; repeat deliveries return the existing record with `duplicate: true`. Late evidence remains pending and is excluded from scoring until examiner confirmation. Database/storage failures return 503 for durable retry; invalid events return 400 and missing sessions return 404. Closed sessions without a reliable end time return 503 rather than guessing a cutoff.

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

## Secondary phone camera contract (parts 1 & 2)

`Exam.requireSecondaryCamera` is Boolean, default false. Session adds `secondaryCamera {paired,pairedAt,lastHeartbeatAt,placementVerified,fixedStandMode,referencePhoto,referencePhotoAt,status}`; status is `not_paired | connected | verified | lost`. Internal pairing hash/expiry/usedAt, current credential ID, disconnect timestamp, and candidateMonitoringStartedAt support auth and watchdog recovery; none contain preview frames. `POST /sessions` optionally returns a sessionToken (scope candidate_session) when SESSION_TOKEN_SECRET is configured and returns the exam requirement.

`POST /pairing/create {sessionId}` requires the matching candidate bearer token; returns `{token,expiresAt,qrUrl,qrImage}`. Token is 32 random bytes, stored hashed, one use, five minutes. `/pairing/redeem {token}` returns `{sessionId,token}` with a four-hour secondary_camera JWT signed by SESSION_TOKEN_SECRET. `/pairing/start {sessionId,prepare?}` validates the verified recent side camera; prepare=true is read-only, otherwise records successful candidate monitoring start.

`POST /pairing/reference-photo` requires `requireSideCameraAuth` and one multipart JPEG `screenshot` (<=512 KB, JPEG magic-byte checked). It stores the clean-desk baseline (or examiner-requested desk check) under verification storage, deletes any replaced reference photo, updates `secondaryCamera.referencePhoto` and `secondaryCamera.referencePhotoAt`, and publishes `secondaryCameraStatus` to the exam owner. `POST /sessions/:sessionId/request-side-snapshot` (teacher-authenticated, owned session) emits `request-desk-snapshot` to the paired phone socket to trigger a fresh reference photo upload.

Socket auth uses `{token,scope}`. Candidate sockets join only their own laptop room; phone scope is secondary_camera. Phone sends heartbeat `{orientation:{alpha,beta,gamma},luminance,trackLive}` every five seconds, orientation, preview-frame (JPEG data URL, <=60 KB, <=3/sec accepted), and placement-result `{criteria:{person,workstation,lighting,steady},orientation,fixedStandMode,verified}`. The backend relays preview-frame `{sessionId,frame}`, placement-result and side-camera-status `{sessionId,status,placementVerified,fixedStandMode}` only to the matching laptop. Dashboard owners receive secondaryCameraStatus `{sessionId,status,fixedStandMode,referencePhoto}`. Preview data is not persisted or audited.

Violation schema adds top-level `source: front_camera | side_camera`, default front_camera, and side-camera types with server-enforced severities: `secondary_camera_disconnected` (sev 3, watchdog-only), `secondary_camera_moved` (sev 3), `secondary_camera_obstructed` (sev 3), `no_face_detected` (sev 3), `cell_phone` (sev 4), `unauthorized_object` (sev 4), and `second_person_detected` (sev 5). Phone multipart `POST /violation` requires scoped auth, matching session, `source=side_camera`, an allowed side-camera upload type, and exactly one JPEG screenshot <=512 KB, without audio. Existing front-camera delivery and late-evidence semantics remain unchanged; no-token callers cannot submit side-camera types/source. See [SIDE_CAMERA.md](SIDE_CAMERA.md) for limitations and real-device acceptance tests.
