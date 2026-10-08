# IntegrityFlow: scope and progress verification

Review date: 3 October 2026 (Asia/Karachi). Baseline: IntegrityFlow Scope v3, dated 8 May 2026, 15 pages. This is a code-backed progress review, not a full acceptance test or a new security audit. No application code was changed while preparing this presentation.

## Executive assessment

The candidate-to-examiner workflow has implementation paths: exam management, candidate entry, consent, self-check, paper viewing, local monitoring, evidence transport, scoring, examiner review and submission. All seven CORE/OPTIONAL modules in the scope have code. Four of the five CORE modules substantially match their requested functionality at code level; AI monitoring partially matches the specified model and classes. Reporting is implemented through an exam summary, CSV export and browser Save PDF. Scope v3 does not require a dedicated automatic PDF generator; the remaining report-content gap is combining all alert logs and screenshots into the exported report.

This is strong progress evidence, but a module count is not an overall completion percentage. Do not claim an independently verified 70%, 90% or 100% without a supervisor-approved weighting and a successful live demonstration. Show the implemented workflow and use the matrix below. Automated checks do not establish AI accuracy, capacity, production security or resource targets.

## Original module matrix

| Scope module | Current implementation | Status and remaining work | Code evidence |
|---|---|---|---|
| 1. Secure environment [CORE], pp. 8-9 | Process allowlist, per-exam allowed apps, dev/exam separation, verified pre-existing open-file timestamp checks | Implemented. Strict enforcement and the specified ten-application test still require a controlled rehearsal with saved work and appropriate permissions. An allowlist is not a complete OS sandbox. | candidate-app/ai-module/whitelist_enforcer.py; candidate-app/electron/main.js |
| 2. AI monitoring [CORE], p. 9 | Head turns, missing/multiple faces, camera occlusion, phone/book ONNX detection, sustained-event filters | Partial against exact scope. Model is YOLO26n, not YOLOv8n. Standard model takes precedence over INT8. Headphones have no detection target. Current environment falls back to OpenCV because legacy MediaPipe Face Mesh is unavailable. Scenario accuracy remains unmeasured. | candidate-app/ai-module/ai_monitor.py: model_path_std/model_path_int8, targets={67,73}, _check_faces_opencv, _check_head_pose |
| 3. Evidence capture [CORE], p. 9 | Event-triggered JPEG evidence, local files, uploads, dashboard display | Implemented with a scope change: vision events capture annotated webcam frames, while environment events use screen captures. Compression aims for 200 KB but does not establish a universal size bound. Valid late evidence now persists with retry deduplication and confirmation-controlled scoring; real-network rehearsal remains. | candidate-app/ai-module/services/capture/; candidate-app/ai-module/ai_monitor.py:_emit_violation; server/src/routes/violations.js |
| 4. Self-check [OPTIONAL], p. 9 | Camera/face, microphone, voice enrollment/confirmation, apps, USB, displays; physical-lab bypass | Implemented. Real camera/microphone/device naming and strict-mode checks need rehearsal on the presentation laptop. | candidate-app/renderer/selfCheck.js; candidate-app/ai-module/server.py |
| 5. Severity scoring [OPTIONAL], p. 9 | Severity aggregation, recency decay, persistent baseline, 0-100 score, dismissed-event exclusion | Implemented. Current recency half-life is approximately 30 minutes, not README's 15-minute claim. A score is a review priority, not probability of cheating. | server/src/services/scoring/DecayScoringStrategy.js; server/src/scoring/severityEngine.js |
| 6. Examiner dashboard [CORE], p. 9 | Active candidates, Socket.IO alerts, risk badges, evidence review, exams/history, warnings/termination and identity/submission views | Implemented. Owner/admin socket isolation and related roster/evidence boundaries were fixed and regression checked on 3 October. A real two-teacher demo remains an acceptance rehearsal. | dashboard/src/pages/Dashboard.jsx; server/src/sockets/violationSocket.js; server/checks/check_socket_isolation.js |
| 7. File submission [CORE], p. 9 | Typed answers with local draft, file uploads linked to session, teacher view/download, PDF/DOCX paper viewing | Implemented. Rehearse actual submission and retrieval. An attachment must be reselected after restart. File timestamp guards are a heuristic, not proof of original authorship. | candidate-app/renderer/examScreen.js; server/src/routes/submissions.js |
| 8. Audit report [ADVANCED], p. 10 | Historical exam summary, final scores, risk distribution, violation breakdown, CSV export and browser Save PDF | Reporting implemented. Exact scope-content coverage remains incomplete: individual alert logs and screenshots open in a separate evidence viewer and are excluded from print. A dedicated automatic PDF generator is not a scope requirement. | dashboard/src/components/ExamSummary.jsx:handleExportCSV, handlePrintPDF and no-print evidence modal; server/src/routes/exams.js:summary |

## Additions beyond the original scope

| Addition | Evidence and qualification |
|---|---|
| Voice/speaker verification and suspicious audio clips | voice_monitor.py uses WebRTC VAD and Resemblyzer. This is explicitly future work in scope section 5.2. It detects mismatch with a reference, not a reliable count of speakers. Profiles persist per session and suspicious clips can upload. |
| Physical-lab mode | main.py and selfCheck.js intentionally bypass camera/voice while retaining environment checks. A distinct deployment mode beyond the remote-exam baseline. |
| USB storage and multiple-display checks | usb_monitor.py and Electron screen handling. USB storage excludes ordinary keyboard/mouse devices. |
| Pre-existing-file/upload guards and clipboard restrictions | whitelist_enforcer.py and examScreen.js. These discourage common shortcuts but are not comprehensive data-loss prevention. |
| Typed answer drafts and integrated paper workspace | examScreen.js extends the original file-only submission scope. |
| Teacher/admin accounts and ownership checks | auth.js, authMiddleware.js, examAccess.js, AuthContext.jsx. Includes refresh-token flow and verification/reset routes. Mail configuration must be rehearsed if shown. |
| Multiple-exam management and lifecycle controls | exams.js, examLifecycle.js, ExamManager.jsx. Goes beyond the original single-active-exam design. No concurrent capacity claim is established. |
| Chat, broadcasts, warning/termination and extensions | messages.js, sessions.js, LiveExamChat.jsx. |
| Priority queue, navigation, intentional empty states and dark mode | Dashboard.jsx, PriorityQueue.jsx and App.jsx. |
| Admin asset/user management and audit log | routes/admin.js and components/AdminDashboard/. These audit logs are different from the original student exam audit-report module. |
| Local/Cloudinary storage providers | services/storage/index.js selects from configured credentials. Cloud storage is optional and not evidence of offline central-server availability. |
| Durable Electron queue, dynamic local ports, health diagnostics and timing logs | ipc/violationBuffer.js, pythonBridge.js, main.py and check_reliability.js. Events still in Python's in-memory transport queue are not crash durable. |
| OpenCV fallback, continuity filters and voice calibration safeguards | ai_monitor.py, voice_monitor.py and config/thresholds.json. These are reliability measures rather than measured accuracy improvements. |

## Scope/documentation corrections to discuss with the supervisor

1. **Voice/privacy:** scope p. 6 excludes voice and p. 12 states no biometric identification data is stored. The added feature writes speaker embeddings to `config/voice_profiles` and suspicious recordings to `audio_evidence`. Consent now discloses profiles, local/uploaded clips and persistence until manual removal; explicit acceptance checks pass. Align the scope and institutional retention policy. No automatic expiry was added.
2. **Model/quantization:** scope names YOLOv8n INT8. Code prefers `yolo26n.onnx` (~9.94 MB) over `yolo26n_int8.onnx` (~2.97 MB). Do not label the active model quantized unless model selection and ONNX graph inspection establish it.
3. **Object classes:** only phone/book targets exist. Headphones need a suitable detector/class and validation or a scope adjustment. Do not promise detection of all printed notes.
4. **Head-pose implementation:** MediaPipe PnP exists, but the installed environment uses OpenCV. The fallback uses relative eye/profile heuristics, not measured gaze angles. Current 18-degree config applies only to MediaPipe yaw.
5. **Inference schedule:** scope says 30 FPS head pose and YOLO every 90 frames. Code targets about 11.7 loop iterations/second and runs objects every third frame. Actual throughput requires measurement.
6. **Risk scoring:** approximately 30-minute recency decay plus a persistent baseline, rather than pure decay to zero. Dismissed events do not contribute.
7. **Multiple exams:** code supports managing several exams. The scope promises one active exam per backend. Capacity needs a fresh benchmark before claiming multi-exam deployment readiness.
8. **Evidence:** webcam stills, enrollment photos and audio clips extend the original screenshot-only evidence description.
9. **Performance:** the scope contains conflicting bandwidth figures (<30 KB/s versus <400 KB/s) and an unsupported 166x comparison. Omit competitor superiority, CPU <5%, guaranteed <2-second delivery, 50-student capacity and accuracy percentages from achievements. Keep measurable targets labelled as targets.

## Remaining work ranked for evaluation

### Before the live presentation

- Plan a separate candidate laptop for the HDMI demo: self-check currently requires one display and has no configured projector exemption.
- Rehearse the complete online workflow with the actual laptop, camera, microphone, server, database and network. Run a separate physical-lab rehearsal.
- Rehearse two independent teacher accounts against the fixed owner/admin boundary. `npm run check:isolation` passes shared socket and related roster/evidence regressions; this does not replace live acceptance testing.
- Clarify the institutional retention policy and model/class scope differences with the supervisor. Voice consent now matches current storage behavior and requires explicit acceptance; automatic retention cleanup remains future work.
- Check authenticated audio playback in the dashboard. The inspected files have valid durations, but player loading/authorization still needs a live check.
- Rehearse strict process enforcement with saved work. Never terminate an application holding unsaved presentation material as an improvised demo.
- Keep only stable, rehearsed features in the main demo. Put optional voice/offline/admin features in Q&A if they have not passed a full rehearsal.

### Before final submission

- Record labelled normal/violation scenarios and calculate false-positive/false-negative rates for head turns, multiple faces, phone/book and voice.
- Measure alert delivery from trigger to visible dashboard update, CPU/RAM over 30 minutes, and 20 simulated clients. The scope's 50-student capacity remains a design statement.
- Decide the missing-headphone requirement and model change, then align scope and technical documentation.
- Rehearse delayed evidence with the real database/storage and network. Valid post-completion delivery, retry deduplication and confirmation-controlled scoring are now implemented and covered by `server/npm run check:late-evidence` (run `npm run check:late-evidence` from the server directory).
- Verify evidence retention, profile cleanup, packaging with a pinned Python environment and recovery after an interrupted exam.
- Extend the existing report export to include each alert log and screenshot if pursuing full advanced-module scope coverage; current summary/CSV/browser PDF reporting already exists.

## Verification evidence

October 3 follow-up: delayed evidence recovery passed controlled HTTP/multipart and durable-buffer checks, including concurrent duplicates, lost acknowledgments, media/database failures, capture-window validation and late-event review/scoring. Isolation, consent, candidate reliability (including 13 Python checks), and dashboard build also passed. `IntegrityFlow_Animated_Progress_Final.pptx` reflects this fix and adds module technology/workflow explanations. Earlier PPTX revisions predate it.

During this preparation, `node check_reliability.js` passed actual local physical-lab and online self-check startup, dynamic-port/instance checks, offline persistence, post-exam local retry and non-overlapping delivery. Its Python runner passed **13 deterministic regression checks** including a real ONNX blank-frame inference and WAV duration checks. It uses temporary local data, fake backend responses and controlled detector inputs.

Previous renderer/dashboard builds passed in this conversation. These tests do not exercise strict process killing, live hardware accuracy, a real authenticated teacher dashboard, real backend/database recovery or multi-client load. A fake-server acknowledgment time is not the scope's dashboard latency measurement.

## Presentation claims that are safe

- "We have implemented the main candidate-to-examiner workflow and all core modules have code paths."
- "AI runs locally and uploads event evidence rather than continuous video."
- "The examiner reviews evidence before making a decision."
- "We added lab mode, speaker verification, offline buffering and management features beyond the original scope."
- "AI scenario validation and capacity/performance measurement are remaining work."

Avoid: "100% accurate", "cheating proof", "crash proof", "no biometric data stored", "fully quantized", "production security fully verified", "50 students tested", or "70% independently verified". It is accurate to say that owner/admin isolation regression checks passed for the repaired event and roster/evidence paths.

Scope source: `C:\Users\Rao Umair\Downloads\FYP-W\IntegrityFlow_Scope_v3_Enhanced.pdf`. Repository paths above are relative to the project root. Status reflects the reviewed working tree, including earlier uncommitted fixes.
