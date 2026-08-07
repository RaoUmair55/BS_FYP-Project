# Candidate App (Electron Shell)

The Candidate App is the desktop application run by students during an exam. It serves as a secure wrapper that bundles the user interface with our AI monitoring module.

## What This Does

This module implements the full end-to-end event pipeline, as well as **Module 1: Whitelist Enforcement**:
1. **Startup**: The Electron main process boots up and immediately starts a local Express receiver on `ELECTRON_RECEIVER_PORT` (e.g., 8766).
2. **Session ID Injection**: Electron injects the active exam's `EXAM_SESSION_ID` into the Python process's environment variables.
3. **AI Module Spawning**: Once the receiver is listening, Electron spawns the Python AI module (`ai-module/main.py`) as a child process and polls its `/health` endpoint until it's ready.
4. **Whitelist Enforcement**: The `WhitelistEnforcer` polls running processes every 2.5s. It terminates unauthorized applications (escalating to force-kills if necessary) and generates violations with increasing severity for repeat offenses.
5. **Violation Detection**: When Python detects a violation (e.g., "unauthorized_app" or "second_person_detected"), it POSTs a payload (including the `sessionId`) to Electron's local receiver.
6. **Forwarding**: The Electron receiver immediately forwards this payload to the central backend server (`SERVER_URL`), with built-in retry logic in case of network instability.

## Files Changed/Added

- `ai-module/whitelist_enforcer.py`: Contains the `WhitelistEnforcer` class that runs a background daemon thread polling `psutil` to kill unauthorized processes.
- `ai-module/config/whitelist.json`: Contains the strict list of allowed exam processes (e.g., `electron.exe`, `explorer.exe`).
- `ai-module/config/README.md`: Explains why each entry in `whitelist.json` exists.
- `ai-module/main.py`: Modified to pass the `EXAM_SESSION_ID` and the electron-forwarding callback to the `WhitelistEnforcer`.
- `electron/main.js`: Modified to inject the dummy session ID when spawning Python.

## Safety List

The `WhitelistEnforcer` maintains a strict `SAFETY_LIST` of critical Windows system processes (e.g., `svchost.exe`, `explorer.exe`, `lsass.exe`) that are never terminated, ensuring OS stability. 
**Note:** The safety list protects the OS, not convenience apps that could be used to bypass monitoring. The AI module itself is protected by its explicit PID (`os.getpid()`), not by broadly allowing `python.exe` or `cmd.exe`.

## Dev vs Exam Mode

To facilitate local development while maintaining strict security during real exams, the whitelist system supports two modes configured via the `APP_MODE` environment variable:
- **Dev Mode (`APP_MODE=dev`)**: Uses the `dev_whitelist` which is relaxed and allows development tools like `cmd.exe`, `powershell.exe`, and `code.exe` (VS Code). This prevents the AI module from aggressively killing your own development environment while you are building and testing the application.
- **Exam Mode (`APP_MODE=exam`)**: Uses the strict `exam_whitelist`. This is the real enforcement configuration that will kill terminals, editors, and other unauthorized tools to prevent cheating. Note: `EXAM_BLOCKED` (not `ALWAYS_BLOCKED`) only applies in exam mode. Development requires browsers/shells/local AI tools to function; these are only forbidden during a real exam session, not during our own development.

**Fail-Safe Default**: If `APP_MODE` is not specified, it safely defaults to `exam` mode. This ensures that if the mode is ever forgotten or misconfigured in production, it fails SAFE (strict) rather than open (relaxed). You can switch modes by updating the `.env` file in the `candidate-app` directory.

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

To verify the end-to-end integration and whitelist enforcement:
1. Ensure `APP_MODE=exam` is set in your `.env` file so the strict exam whitelist is used. (Testing in dev mode does not count as proof of the security feature!)
2. Start the **backend server** (e.g., `npm start` in `/server`).
3. Start the **dashboard** (e.g., `npm run dev` in `/dashboard`).
4. Start this **Electron app** (`npm start`). Ensure it boots successfully and logs that it is running in EXAM mode.
5. Open an unauthorized application like `Calculator` (`calc.exe`), or try to open a terminal like `PowerShell` or `VS Code`.
6. Confirm that the application is forcefully terminated within ~3 seconds.
7. Look at the dashboard — an `unauthorized_app` violation should appear in the `AlertFeed`.
8. Re-open the same unauthorized application and confirm that the new violation generated has an increased severity level (escalation).

## Next Steps

This setup proves the full pipeline works. Real AI module integration will happen once `ai_monitor.py` is fully implemented and ready to start POSTing real events to the local receiver.
