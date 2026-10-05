<!--
IntegrityFlow file overview
Purpose: Presentation reading guide for candidate-app.
How it works: Maps the candidate flow and explains files that cannot contain comments.
Connection: Complements the explanatory headers in the authored source files.
-->
# Candidate app: presentation reading guide

Every authored Python, JavaScript, HTML and CSS file has an opening comment explaining its purpose, main steps and connections. HTML comments follow the doctype so the browser stays in standards mode. Comments also describe the dependency list, environment template, SVG logo and existing Markdown documents.

## Follow the candidate journey

1. **Exam entry:** `renderer/login.html` and `login.js` validate the exam code and obtain the exam rules.
2. **Consent:** `renderer/consent.html` and `consent.js` disclose monitoring and record acceptance before registration.
3. **Identity:** `renderer/identity.html` and `identity.js` collect the name/roll number and create the candidate session.
4. **Readiness:** `renderer/selfCheck.html` and `selfCheck.js` check the environment and enroll the online candidate's voice reference. Lab exams bypass camera/voice checks.
5. **Exam:** `renderer/examScreen.html` and `examScreen.js` display the paper, manage answers/timing and handle examiner communications.

`electron/main.js` coordinates this journey. `electron/preload.js` exposes the limited `window.api` bridge that the screens use to request native operations.

## Follow a monitoring alert

The camera, voice, application and USB monitors call the callback supplied by `ai-module/main.py`. Python first stores the event through `services/violation_delivery.py`, then hands it to Electron's local receiver. `electron/ipc/violationForwarder.js` passes it to `pythonBridge.js`, which uses `violationBuffer.js` for durable storage and uploads to the central server. Saved alerts can be retried after interruptions. The central server and examiner dashboard handle scoring and review; the candidate app does not decide that someone cheated.

## Files that cannot safely hold opening comments

| File or group | What it does |
| --- | --- |
| `package.json` | Candidate-level npm commands for starting the app, installing dependencies and checking reliability. JSON does not support comments. |
| `electron/package.json` | Electron entry point, app packaging/icon settings, dependency list and renderer build/check commands. |
| `electron/package-lock.json` | Generated exact npm dependency resolution; managed by npm. |
| `ai-module/config/thresholds.json` | Detection thresholds and timing settings consumed by monitoring code; values influence sensitivity and persistence requirements. |
| `ai-module/config/whitelist.json` | Base process whitelist and related enforcement configuration, combined with examiner-permitted apps. |
| `ai-module/yolo26n.onnx` | Standard YOLO object-detection model loaded using ONNX Runtime. |
| `ai-module/yolo26n_int8.onnx` | Quantized YOLO model alternative considered by the runtime. |
| `ai-module/yolo26n.pt` | PyTorch-format YOLO weights; the current camera implementation uses the ONNX exports for inference. |
| `ai-module/models/face_landmarker.task` | MediaPipe Tasks model used for face landmarks when available. |
| `ai-module/models/face_detection_yunet_2023mar.onnx` | YuNet face detector used by the offline face-comparison script. Its presence does not mean the live monitor uses it. |
| `electron/assets/icon.png`, `electron/assets/icon.ico`, `renderer/assets/icon.png` | Binary application/branding images. |
| `data/violations_offline_buffer.db` | Local SQLite data file; contains persisted data rather than source code. |
| `.env`, if present | Machine-specific runtime settings; left untouched to preserve configuration and avoid exposing credentials. See `.env.example`. |

## Generated and runtime folders

Dependencies and environments (`node_modules/`, `venv/`, `.venv/`), bundled renderer output (`renderer/dist/`), Python caches (`__pycache__/`), recorded audio, screenshots and stored voice references are not handwritten source. They are left untouched. Editing bundled code or binary evidence to insert comments could corrupt it or be overwritten at the next build.

For your presentation, start with the screen sequence, then explain the Python monitors and alert-delivery chain. Open the file's first comment when you need a quick explanation of a particular implementation.
