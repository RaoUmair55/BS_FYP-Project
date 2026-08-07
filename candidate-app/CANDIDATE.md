# Candidate App (Electron Shell)

The Candidate App is the desktop application run by students during an exam. It serves as a secure wrapper that bundles the user interface with our AI monitoring module.

## What This Does

This module implements the full end-to-end event pipeline, as well as **Module 1: Whitelist Enforcement**:
1. **Startup**: The Electron main process boots up and immediately starts a local Express receiver on `ELECTRON_RECEIVER_PORT` (e.g., 8766).
2. **Session ID Injection**: Electron injects the active exam's `EXAM_SESSION_ID` into the Python process's environment variables.
3. **AI Module Spawning**: Once the receiver is listening, Electron spawns the Python AI module (`ai-module/main.py`) as a child process and polls its `/health` endpoint until it's ready. By default, it spawns in `dev` mode to avoid accidentally killing your OS or development environment prematurely.
4. **Self-Check Flow (Mode Transition)**: The app loads the `selfCheck.html` screen, verifying the camera, microphone, and checking for unauthorized background apps. Clicking "Begin Exam" triggers an IPC call that gracefully restarts the Python AI module in strict `exam` mode and transitions the UI to the actual exam screen.
5. **Whitelist Enforcement**: The `WhitelistEnforcer` polls running processes every 2.5s. It terminates unauthorized applications (escalating to force-kills if necessary) and generates violations with increasing severity for repeat offenses.
6. **Violation Detection & Screenshot Capture**: When Python detects a violation (e.g., "unauthorized_app"), it captures a screenshot (compressed to <200KB), saves it locally, and POSTs a payload (including the `sessionId` and `screenshotPath`) to Electron's local receiver.
7. **Forwarding**: The Electron receiver immediately forwards this payload to the central backend server (`SERVER_URL`) via a `multipart/form-data` request, attaching the screenshot image along with built-in retry logic in case of network instability.

## Files Changed/Added

- `renderer/selfCheck.html` & `renderer/selfCheck.js`: The initial self-check UI and client-side logic for verifying hardware permissions and checking background apps before allowing the exam to begin.
- `ai-module/whitelist_enforcer.py`: Contains the `WhitelistEnforcer` class that runs a background daemon thread polling `psutil` to kill unauthorized processes. Now includes `check_running_apps()` for one-off app scans.
- `ai-module/server.py`: Exposes the new `GET /check-apps` endpoint so the Electron frontend can query running unauthorized apps.
- `ai-module/config/whitelist.json`: Contains the strict list of allowed exam processes (e.g., `electron.exe`, `explorer.exe`).
- `ai-module/config/README.md`: Explains why each entry in `whitelist.json` exists.
- `ai-module/screenshot_capture.py` (NEW): Captures the full screen using `mss` and compresses it to a lightweight JPEG (<200KB) upon violation detection.
- `ai-module/main.py`: Modified to pass the `EXAM_SESSION_ID` and the electron-forwarding callback to the `WhitelistEnforcer`.
- `electron/main.js`: Modified to initially load `selfCheck.html`, handle the `start-exam-mode` IPC command (restarting python), and act as a proxy for the `/check-apps` endpoint.
- `electron/preload.js`: Exposes `checkApps()` and `startExamMode()` to the renderer.
- `electron/ipc/pythonBridge.js` & `electron/ipc/violationForwarder.js`: Updated to handle `multipart/form-data` forwarding of the screenshot image to the backend server.

## Safety List

The `WhitelistEnforcer` maintains a strict `SAFETY_LIST` of critical Windows system processes (e.g., `svchost.exe`, `explorer.exe`, `lsass.exe`) that are never terminated, ensuring OS stability. 
**Note:** The safety list protects the OS, not convenience apps that could be used to bypass monitoring. The AI module itself is protected by its explicit PID (`os.getpid()`), not by broadly allowing `python.exe` or `cmd.exe`.

## Dev vs Exam Mode

To facilitate local development while maintaining strict security during real exams, the whitelist system supports two modes configured via the `APP_MODE` environment variable:
- **Dev Mode (`APP_MODE=dev`)**: Uses the `dev_whitelist` which is relaxed and allows development tools like `cmd.exe`, `powershell.exe`, and `code.exe` (VS Code). This prevents the AI module from aggressively killing your own development environment while you are building and testing the application.
- **Exam Mode (`APP_MODE=exam`)**: Uses the strict `exam_whitelist`. This is the real enforcement configuration that will kill terminals, editors, and other unauthorized tools to prevent cheating. Note: `EXAM_BLOCKED` (not `ALWAYS_BLOCKED`) only applies in exam mode. Development requires browsers/shells/local AI tools to function; these are only forbidden during a real exam session, not during our own development.

**Fail-Safe Default**: If `APP_MODE` is not specified, it safely defaults to `exam` mode. This ensures that if the mode is ever forgotten or misconfigured in production, it fails SAFE (strict) rather than open (relaxed). You can switch modes by updating the `.env` file in the `candidate-app` directory.

## Architecture Note: Mode Transition
The `selfCheck.html` screen serves as a deliberate and necessary transition point between the relaxed `dev` environment and the strict `exam` environment. Without this, starting the Electron app directly in `exam` mode would immediately aggressively kill any development tools (terminals, IDEs, local AI instances) running on the same machine, making testing and development extremely painful and risky. By spawning the AI module in `dev` mode initially, students can safely perform checks, and the strict mode is only applied at the exact moment they commit to beginning the exam.

## Architecture Note: App Check Filtering
During the self-check phase, listing raw running processes surfaced OS services, drivers, and antivirus components that students cannot and should not attempt to close. We enforce strict filtering by ignoring system accounts (`NT AUTHORITY\SYSTEM`, `LOCAL SERVICE`, etc.), enforcing that the process belongs to the logged-in user, and ignoring a `KNOWN_BACKGROUND_SERVICES` list for common false positives (e.g., `msmpeng.exe`, `securityhealthservice.exe`). This is a best-effort list, not exhaustive, and may need additions as more false positives are found during testing.

## How to Run

> **Note:** The backend server and dashboard must be running separately to see real results.

1. Navigate to the `electron` directory:
   ```bash
   cd candidate-app/electron
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` (if not already done) and configure ports if necessary.
4. Start the application:
   ```bash
   npm start
   ```

## Testing This Step

> **Warning:** Before running this, confirm with the teammate currently working on `ai-module/` that it's safe to spawn/touch that file to avoid concurrent edits.

To verify the end-to-end integration, self-check flow, and whitelist enforcement:
1. Start the **backend server** (e.g., `npm start` in `/server`).
2. Start the **dashboard** (e.g., `npm run dev` in `/dashboard`).
3. Start this **Electron app** (`npm start`). Ensure it boots successfully, spawns Python in DEV mode, and opens on `selfCheck.html`.
4. **Test Permissions**: Deny camera/mic permissions and confirm the checks show a failure state (red X). Grant them and confirm the checks pass (green check).
5. **Test App Checking**: Open an unauthorized application (like `calc.exe`). Click "Run App Check" and confirm it is listed with a prompt to close it. Close it, click "Re-check Apps", and confirm the check passes.
6. **Test Mode Transition**: Confirm "Begin Exam" is disabled until all checks pass. Click it, and confirm the app transitions to `examScreen.html`.
7. **Verify Enforcement**: Look at the terminal output to confirm the Python AI module restarted and logged that it is running in EXAM mode.
8. Open an unauthorized application like `Calculator` (`calc.exe`).
9. Confirm that the application is forcefully terminated within ~3 seconds.
10. Look at the dashboard — an `unauthorized_app` violation should appear in the `AlertFeed`.
11. Confirm a screenshot file appears in `ai-module/screenshots/` and its file size is roughly in the 50-200KB range.
12. Confirm that clicking into EvidenceViewer for that session actually displays the captured screenshot image (not a broken image icon).
13. Re-open the same unauthorized application and confirm that the new violation generated has an increased severity level (escalation).

## Known Limitation
- The face detection in `selfCheck.js` is currently a basic placeholder (verifying only that the video stream is active/not blank). This will be upgraded once Module 2's MediaPipe integration is complete.
- Screenshots currently trigger only from Module 1 (whitelist) violations. Module 2 integration is pending that module's completion.

## Next Steps

This setup proves the full pipeline works. Real AI module integration will happen once `ai_monitor.py` is fully implemented and ready to start POSTing real events to the local receiver.
