# Secondary phone camera — parts 1 & 2

## Architecture and privacy

The phone and candidate laptop each connect to the HTTPS backend. They never discover or connect to each other: there is no WebRTC, STUN, TURN, local network address exchange or direct camera stream. The phone page is served at `/side-camera/`. MediaPipe Tasks Vision 0.10.21, its WASM files, and EfficientDet-Lite0 are self-hosted beside that page. Inference runs in the phone browser.

During setup only, the phone sends 480-pixel-wide JPEG previews at 2 fps and quality 0.5 through Socket.io. The backend relays them transiently to the authenticated candidate session's laptop room, using volatile delivery. It discards previews with no laptop listener, after verification, over 60 KB (encoded payload), or above 3 frames per second. Preview frames are never saved, put in audit records or sent to teachers. Application/proxy operators must not enable request-body or Socket.io payload logging for this feature.

After verification there is no live video stream or ongoing preview. Instead, the phone captures one Clean Desk Baseline reference photo (`POST /pairing/reference-photo`), keeps EfficientDet-Lite0 running locally at a low-frequency 3-second cadence on the phone, and only uploads a single JPEG snapshot when a violation is confirmed or when the examiner explicitly clicks **Capture Desk Check** (`POST /sessions/:sessionId/request-side-snapshot`). `candidate-app/ai-module/` is unchanged.

## Configuration and development HTTPS

In `server/.env`, configure:

```dotenv
PUBLIC_URL=https://your-public-backend.example.com
SESSION_TOKEN_SECRET=<a unique random secret with at least 32 characters>
```

Generate a secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit it. Keep it separate from the examiner JWT secret.

The candidate app must use the same HTTPS origin in `candidate-app/.env`:

```dotenv
SERVER_URL=https://your-public-backend.example.com
```

The phone camera needs a secure context; a laptop's HTTP LAN address is not sufficient. For development, start the backend on port 5000 and run either:

```sh
cloudflared tunnel --url http://localhost:5000
# Or, with your reserved/static ngrok domain:
ngrok http --url=your-domain.ngrok-free.app 5000
```

Use the resulting HTTPS origin for PUBLIC_URL and SERVER_URL, then restart the backend and candidate app. A Cloudflare Quick Tunnel hostname changes when recreated, so update both settings and generate a new QR code after changing tunnels. The browser-to-backend leg is HTTPS/WSS; the local tunnel agent forwards to the development server over loopback HTTP. Production should use a stable HTTPS backend URL. Cloudflare instructions: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

No global permissive CSP is used. Only `/side-camera/` permits same-origin WASM (`wasm-unsafe-eval`) and camera/motion permissions. The rest of the backend keeps Helmet defaults. Only loopback forwarding proxies are trusted by the development Express configuration; configure a production reverse proxy explicitly rather than trusting arbitrary forwarded headers.

## Pairing and authentication

1. `POST /sessions` returns the candidate session ID and, when SESSION_TOKEN_SECRET is configured, a session JWT with scope `candidate_session`. Side-camera-required exams reject entry if the signing secret is missing. Existing exams without the flag continue to work without configuring this feature.
2. The optional ExamManager checkbox persists `Exam.requireSecondaryCamera` (default false). The flag travels through exam lookup, identity registration, Electron session state and self-check; it is not merely a displayed rule.
3. `POST /pairing/create` requires `requireSessionAuth` and a matching session ID. It returns a 32-byte random token, 5-minute expiry, QR data image and `${PUBLIC_URL}/side-camera/?token=...`. Only its SHA-256 hash is stored. Creating a token replaces any earlier unused token for that session.
4. After the phone's Start tap, `/pairing/redeem` atomically consumes a valid, unused, unexpired token. The rate-limited endpoint returns a 4-hour HS256 JWT scoped to `secondary_camera` and bound to that session and pairing credential ID. Re-pairing replaces the previous phone credential. Pairing creation/redemption are audited without raw tokens or frames.
5. `requireSideCameraAuth` verifies expiry, scope, active session, credential ID and requested session. Phone tokens cannot create pairing codes, join another session, act as teachers, or submit front-camera violation types. The candidate laptop also joins only its own authenticated room. One current phone socket is retained per session; replacement sockets close the previous connection.
6. The raw pairing URL is cleared from browser history immediately; responses and phone page use no-store and no-referrer. A session-scoped phone credential/baseline is saved in sessionStorage to permit a same-tab reload, which requires another Start tap for camera permissions. A new tab needs a fresh QR code. Credentials are bearer secrets; never share the QR link.

This checkout previously had no candidate session auth middleware or candidate socket auth. Those were added narrowly for this flow; unrelated legacy candidate endpoints were not redesigned.

## Setup on the phone and laptop

Before Start, instructions ask for charging, Do Not Disturb, and propping the phone on the left or right side of the exam desk (~arm's length away) on stacked books or a sturdy stand (landscape gives a wider view, portrait is also accepted). The Start gesture requests rear camera, Wake Lock and iOS motion permission when needed, then redeems the token. Wake Lock is reacquired on visibility changes when supported.

At about 1 fps, placement requires all four criteria to hold for three seconds (with a 1-tick flicker grace so a single dropped AI frame doesn't reset progress):

- A foreground person clearly visible (`width >= 10%`, `height >= 22%`, not covering `>= 95%` of the frame; shoulders/back/lower body may naturally touch edges from a side angle).
- A workstation item detected by EfficientDet-Lite0 (`laptop`, `keyboard`, `mouse`, or `tv` at setup threshold `>= 0.38`; Part-2 exam violation objects enforce stricter `>= 0.52` confidence). If person, lighting, and steadiness hold for 12 seconds while only side-angle workstation AI misses, an assisted **"My Laptop Is Visible — Confirm Placement"** button unlocks (still capturing and sending the Clean Desk Baseline photo for examiner visual verification).
- Mean luminance above 35 on a 0–255 scale.
- Available orientation readings (or Fixed Stand Mode) with less than 5 degrees of tilt (`beta`/`gamma`) variation — ignoring magnetic compass (`alpha`) jitter near laptops. During setup only, subtle green/blue bounding boxes for detected Person/Workstation are drawn onto the transient laptop preview so the candidate can aim easily.

Each criterion is shown pass/fail on the phone and candidate laptop. Local pass immediately stops preview emission; server acknowledgement marks placement verified, removes the laptop preview and enables Begin Exam only when all other self-checks pass. A server-side readiness check also rejects beginning without verified, recent phone contact. The server watchdog is armed only after the Electron monitoring startup succeeds, and runs only after the exam has started/paper is released. If the feature is not required, the extra self-check, socket and status item do not appear.

## Monitoring and violations

Heartbeat every five seconds contains orientation, mean luminance and video-track-live state. The phone also emits `orientation`. A server check runs each second:

- No heartbeat for at least 25 seconds, or a dropped socket that has not recovered for 25 seconds, while monitoring and the exam are active: persist one severity-3 `secondary_camera_disconnected`, set `lost`, and publish status. A compare-and-set claim prevents duplicate incidents. Reconnection resets contact and restores connected/verified status without a new alert inside the grace period.
- More than 10 degrees from the verified baseline for over 3 seconds: one severity-3 `secondary_camera_moved` with one JPEG snapshot, at most once per 60 seconds.
- Mean luminance below 8 for over 5 seconds, or an ended video track: one severity-3 `secondary_camera_obstructed` snapshot per continuous obstruction. An ended track uses the last available frame and says so in the reason. Bright/live recovery clears the latch.
- **Part 2 On-Device Desk AI Monitoring (~3s interval):** After placement verification, EfficientDet-Lite0 continues running locally on the phone once every ~3 seconds (skipping dark/obstructed frames) with sustained confirmation checks and a 60-second per-type cooldown:
  - Extra phone detected (`cell phone`) for 2 consecutive checks (~6s): severity-4 `cell_phone` with desk snapshot.
  - Unauthorized desk material (`book`, `tv`, or `>= 2` laptops/screens) for 2 consecutive checks (~6s): severity-4 `unauthorized_object` with desk snapshot.
  - Extra foreground person (`>= 2` persons meeting foreground size thresholds) for 2 consecutive checks (~6s): severity-5 `second_person_detected` with desk snapshot.
  - Candidate absent from side frame (`0` persons) for 4 consecutive checks (~12s): severity-3 `no_face_detected` with desk snapshot.
- **Clean Desk Baseline & On-Demand Desk Check:** On 5-second placement verification, the phone uploads one clean-desk JPEG (`POST /pairing/reference-photo`) stored on `session.secondaryCamera.referencePhoto` and shown in the examiner Dashboard's **Camera & Identity** tab. During an active exam, the examiner can click **Capture Desk Check** (`POST /sessions/:sessionId/request-side-snapshot` → socket `request-desk-snapshot`) to refresh the desk reference photo on demand.
- **Fixed Stand Mode transparency:** If a phone browser does not expose `DeviceOrientationEvent` readings, placement can still verify in Fixed Stand Mode (`fixedStandMode: true`), which is saved on the session and surfaced as a badge in StudentList and EvidenceViewer.

Phone violation snapshots use authenticated multipart `POST /violation`, fixed `source=side_camera`, matching session, and an allowed side-camera upload type (`SIDE_UPLOAD_SEVERITY` enforces authoritative server severities). One JPEG up to 512 KB is accepted, no audio; uploads are capped at 20 requests per session per minute. Existing storage, event IDs, examiner review and scoring are reused. A bounded in-memory queue retries up to five pending events while the page remains open; it does not survive closing the browser. The server disconnect alert is independent of that queue.

Candidate exam UI shows a calm restore-connection warning. Its Reconnect phone disclosure can generate a fresh QR code after a closed tab or expired phone credential; placement must pass again without closing the answer workspace. StudentList shows status live. Dashboard `secondaryCameraStatus {sessionId,status}` is sent only to the exam owner, with no broad admin exception. Existing violation/evidence access rules continue to apply. All four main alert/evidence/summary views use shared labels for the three new types; snapshots remain private exam evidence.

## Automated checks and verification status

```sh
cd server
npm run check:side-camera
```

The tests use real HTTP and Socket.io with isolated model/storage doubles, including token replacement/reuse/expiry, wrong session/scope, preview size/rate and privacy, post-verification stop, owner-only status, start gating, grace/reconnect/one-disconnect behavior, snapshot authentication and disabled exams. A separate test runs the actual phone decision loop against controlled motion/frame/time inputs, including all four placement failures, movement timing/cooldown and obstruction latching. Passing simulated tests is not a claim of real-phone verification.

### Required real-phone acceptance checklist (pending)

Use Chrome on the actual phone through the public HTTPS tunnel and a new required-camera exam:

- Pair; deny camera or motion permission and check clear retry guidance; allow both and pair successfully.
- Fail each criterion separately: crop the person, hide laptop/keyboard, reduce light, move/rotate the phone. Then pass all for five seconds.
- In remote network inspection, confirm preview messages stop after verification; there must be no ongoing image uploads except triggered snapshots.
- Reuse a redeemed token; redeem a token older than five minutes; generate a replacement then redeem the old one. All must fail.
- Submit/join using another session's credential or a phone token on a candidate route. Reject each mismatch.
- Knock/rotate over ten degrees for over three seconds: one moved alert and snapshot; no repeat inside 60 seconds.
- Cover the lens for over five seconds; end the video track. Verify obstruction evidence and the ended-track last-frame explanation.
- Close the tab: one disconnect alert after about 25 seconds, only while the exam is running.
- Airplane mode for less than 25 seconds, then restore: reconnect without a disconnect violation. Repeat for more than 25 seconds and verify one incident.
- Verify candidate and owner dashboard status. A different teacher must receive neither status nor preview, and the owner must never receive preview frames.
- Run a complete exam with requireSecondaryCamera=false and confirm its original flow is unchanged.

## Limits to explain honestly

Mobile browsers may throttle, suspend or discard background tabs, so an interruption is an operational alert rather than proof of misconduct. Wake Lock/orientation permission support differs by device; unavailable motion readings deliberately block placement rather than pretend it passed. Students must keep the page open and charged. Euler-angle readings can vary with sensor quality and device position; calibrate on the actual phone before evaluation.

The phone JavaScript and sensors run on the student's device and can be tampered with; this is a review signal, not a trusted attestation or identity check. A whole person bounding box is only a placement heuristic: it does not prove anatomical head/shoulder visibility. EfficientDet can miss a partially visible workstation. There is no phone face identity recognition or second-person violation detector in this part.

The setup preview is a transient server relay, not peer-to-peer and not stored. WebSocket buffers still exist briefly in transit. Event snapshots are retained under existing evidence retention until authorized removal; there is no new automated expiry. A four-hour phone credential requires fresh pairing after expiry. A page closure loses its unacknowledged in-memory event queue, though the server independently detects loss of contact. Run the real-phone checklist before relying on this for assessment.

## Current development handoff (29 October 2026)

The approved temporary Cloudflare tunnel and backend were started for phone verification. The backend health check reached MongoDB connected, and the public phone page returned HTTP 200 with the expected CSP/camera headers. The local ignored server/candidate environment files use the same temporary HTTPS address. A private SESSION_TOKEN_SECRET was generated without displaying it. Restart the candidate app to load its new backend address.

The isolated checks, browser model/WASM loading, mobile setup layout, candidate Begin gating, normal-exam no-socket behavior, and existing socket/camera/input/delayed-evidence regressions passed. Physical Chrome camera, motion sensors and the real-phone acceptance checklist above still require the user's phone. No real exam was created or modified for these checks.

The temporary services are not installed as Windows services. Their process IDs are recorded in `tmp/side-camera-tunnel.pid` and `tmp/side-camera-server.pid`. Stop those development processes when finished testing. The downloaded Cloudflare executable is in `%TEMP%/IntegrityFlow-side-camera-tools/cloudflared.exe`. To restart the tunnel in PowerShell:

```powershell
& "$env:TEMP/IntegrityFlow-side-camera-tools/cloudflared.exe" tunnel --url http://localhost:5000
```

After a new tunnel hostname is assigned, update PUBLIC_URL and candidate SERVER_URL and restart both apps. Do not treat the temporary hostname as a permanent deployment address.
