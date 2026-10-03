# Candidate reliability review

## Startup and environment

The two local services now bind to available loopback ports. Python announces its bound port to Electron; Electron supplies its receiver port to Python. The central server URL remains configured separately in `.env`. Startup no longer terminates an unrelated process using port 8000.

Python selection is shared between the app and the reliability check: explicit `PYTHON_PATH`, an existing project virtual environment, then `python`. A missing configured interpreter or script produces a diagnostic. UTF-8 child-process output prevents Windows console encoding crashes. Health responses must match the current process instance; a different local service cannot satisfy startup. Startup has a two-minute limit and detects early process exit.

Health checks report failed initialization, camera inactivity, missing object detection, voice failures and USB enumeration errors. The exam screen distinguishes a failed monitor from lost server connectivity. Network operations have time limits; polling and submission cannot overlap themselves. Successful submission stops local monitoring.

## False-positive fixes

- OpenCV gaze fallback learns a neutral eye position instead of treating a normally high camera/face position as looking upward. The lateral eye calculation uses the actual image region width. This remains a heuristic, not an eye tracker.
- Object alerts require three consecutive detections of the same class. Parsing selects the winning class, and phone alerts respect the phone-detection rule. Multiple-person alerts require a sustained observation.
- Camera gaps reset accumulated observation timers; detector exceptions are reported instead of silently swallowed.
- USB storage is reported once per connection, rather than repeatedly every scan. Empty readers are excluded. Enumeration failure is reported instead of being treated as a clean scan.
- Voice reference files and calibration audio are validated. Reference writes are atomic. Silence does not count as voiced duration; continuous segments are bounded, and widely separated mismatches cannot accumulate into one alert.
- Application window titles such as “answers” alone no longer justify terminating an application. The pre-existing-file guard uses verified open file paths and timestamps. Windows shortcut targets use native resolution rather than binary guessing.

Microphone self-check releases its stream after passing. Failed identity-photo upload cannot display a successful result. Offline delivery is serialized and continues retrying persisted events after local monitoring stops. Screenshot files are no longer deleted solely for being older than 24 hours, since they may still be referenced by queued evidence.

## Runnable verification

From `candidate-app`, run `npm run check:reliability` with the same interpreter used for the application. The check uses owned child processes, temporary data and loopback HTTP servers. It does not start process enforcement or capture from your camera/microphone.

It checks actual physical-lab and online self-check startup, dynamic ports, process identity, the face endpoint, offline persistence and non-overlapping retries. Twenty-five Python regression checks cover gaze baseline, object continuity and rule handling, class selection, real ONNX inference on a blank frame, multiple-person continuity, USB insertion, verified file enforcement, voice mismatch continuity and failed-camera health.

## Rehearse before the panel

1. Run the reliability check before leaving home and again on the presentation laptop. Keep its Python environment and model files together; do not switch interpreters at the venue.
2. Confirm `SERVER_URL` is reachable on the university network. Dynamic local ports do not fix a remote server address, database outage or network restriction.
3. Complete an actual online exam self-check with the default camera and microphone. Sit facing the screen during initial gaze observations and voice calibration. Rehearse normal reading/typing, a sustained phone observation, a second person and speaker verification under the room’s lighting and noise.
4. Rehearse physical-lab mode separately: camera and voice bypass are intentional. Check USB insertion and allowed applications. Use saved work when testing strict enforcement because unauthorized processes may be terminated.
5. During an active practice session, disconnect/reconnect the network and confirm queued evidence arrives. Submit typed answers and an attachment. Typed drafts persist locally; attachments must be reselected after a restart.

## Remaining limits

These checks establish runtime behavior, not a measured false-positive rate. Glasses, camera angle, lighting, background noise and similar voices still affect detection. Speaker mismatch and gaze alerts need examiner review; they are not proof of misconduct. Camera/microphone hardware failures are surfaced, not silently bypassed.

Evidence captured within a session's start/end window can now be delivered after completion or termination. Electron preserves its original timestamp and stable event ID across retries; legacy queue rows receive a deterministic ID. Database/storage failures return retryable errors instead of acknowledging lost evidence. Invalid events (400) and missing sessions (404) are discarded with a diagnostic.

Late arrivals remain pending review, are labelled in the evidence timeline, and affect risk scores only after examiner confirmation. They do not reopen sessions or emit ordinary live alerts. Use Refresh in the historical summary/evidence viewer after connectivity returns. Candidate/server clocks must be synchronized, and queued local evidence files must remain available. Previously discarded events cannot be recovered by this change.

From `server/`, run `npm run check:late-evidence` for real loopback HTTP/multipart and durable-buffer checks with isolated database/storage doubles. It covers post-completion delivery, duplicate and concurrent retries, lost acknowledgments, timestamp boundaries, storage/database failures, and review-controlled scoring. Real MongoDB/cloud-storage recovery still needs a practice exam.

Strict process termination and real hardware detection were not exercised by the automated checks. Python is still an external runtime, so a packaged Electron app is not a self-contained AI installation. Retained evidence needs a deliberate retention policy once queued references are accounted for.

## Voice enrollment update

Enrollment records eight seconds plus a separate four-second confirmation. At least three seconds of processed enrollment speech and two seconds of confirmation speech are required. Clipped samples and inconsistent embeddings are rejected before replacing a profile. Browser audio processing is disabled to better match raw Python capture; microphone labels are checked against the Python default input when provided. Windows device naming can vary: a mismatch needs a real-device rehearsal rather than bypassing the check.

Voice alerts retain their existing event identifier and severity, but display “Possible Unfamiliar Speaker.” A 60-second cooldown prevents repeated alerts for one conversation. Verification and speech-detection errors are exposed in health checks. The similarity cutoff remains 0.75 pending evaluation with real recordings; automated tests do not establish its accuracy.

## Alert timing and playback follow-up

Lateral detection uses a 0.5-second sustained window. MediaPipe yaw is configured at 13 degrees relative to the calibrated neutral pose; OpenCV fallback instead uses an eye-offset threshold of 0.10 relative to its initial neutral baseline (it does not measure degrees). Sit facing the screen during initial observations. Camera framing and detection misses can still delay a turn classification.

Python first saves alerts in a standard-library SQLite spool under Electron's user-data directory (`python-alerts/pending.sqlite3`). One worker retries local handoff every two seconds and removes a row only after durable Electron acceptance. Event ID and capture timestamp survive retries/restarts. Electron persists before acknowledging the local receiver and uploads asynchronously. Saved UUID-bearing events can recover during self-check, while new self-check events remain disabled. Dashboard alerts still arrive after server evidence storage; the Electron offline retry interval remains 12 seconds.

Continuous voice now verifies three-second windows instead of waiting up to ten seconds. Two valid mismatches are still required; short speech can intentionally pass without an alert. Verification runs on a bounded worker so embedding computation cannot stop microphone reads. Very low-energy segments are ignored and evidence saving requires real PCM samples; failed evidence creation reports a monitoring error instead of emitting an alert with no clip. The 60-second cooldown remains. The fixed similarity threshold still requires real-room evaluation.

Existing local and server WAV files inspected during this review had valid headers and nonzero durations. A zero-duration player therefore does not by itself prove an empty recording: authorization, URL and loading failures must also be checked. Audio players now show a loading-failure message rather than leaving an unexplained player at zero. Existing files were not modified.

## Face/head-direction tracking update

The installed Python 3.14 / MediaPipe 0.10.35 runtime supports Tasks, but no longer exposes legacy `solutions.face_mesh`. The camera monitor now prefers the local Face Landmarker model in VIDEO mode, with up to three faces and detection/presence/tracking confidence thresholds of 0.6. The tested MediaPipe version is pinned in requirements. Legacy Face Mesh and Haar are retained as fallbacks; repeated Tasks inference failures switch to Haar.

At exam start, sit facing the screen for about two seconds. Twenty stable, single-face pose observations establish a neutral baseline. A profile beyond 20 degrees cannot establish that baseline. Head-direction alerts wait for calibration, while missing-face, occlusion, multiple-person and object monitoring continue. Moving during calibration postpones it. The baseline assumes the candidate follows the forward-facing instruction; it is not an identity or gaze calibration.

Head pose is estimated with landmarks plus OpenCV PnP. Unusable/small/reprojection-inconsistent geometry is rejected. Relative angles are smoothed, Euler wraparound is handled, and a three-degree exit margin reduces threshold chatter. Multiple faces suppress head-pose classification to avoid switching to a bystander's pose; multiple-person counting remains active. Camera gaps reset smoothing and dwell timers. Direction changes restart dwell rather than accumulating left and right movements.

Current configured windows are lateral 13 degrees for 0.5 seconds, downward 2 seconds and upward 1 second. Repeated head alerts have a three-second cooldown. Actual dashboard arrival still includes inference, evidence capture/upload and storage time. A head turn is an observation requiring review, not proof of misconduct, and this is not eye-only gaze tracking.

`python check_detection.py` covers real model initialization/blank inference, missing-model fallback, neutral-pose jitter, Euler wraparound, unstable calibration, direction changes and downward duration, alongside the existing object, voice, USB and health checks. `python evaluate_faces.py` compares labelled image face counts using Haar, YuNet and MediaPipe; YuNet is deliberately not enabled in live exams until a representative comparison supports it. Model provenance and hashes are in `ai-module/models/README.md`.

The model successfully loaded and inferred with networking restricted. MediaPipe's native library also logged failed Clearcut diagnostics-upload attempts; those failures did not stop local inference. No application frame upload was added. Real webcam rehearsal is still required to measure false positives, missed turns, latency and load under the presentation room's conditions.

## Monitoring follow-up fixes

- Teacher-approved existing files are configured when creating an exam: `rules.permittedFiles` accepts at most 50 exact absolute Windows candidate-PC paths. No wildcards or whole-folder exemptions. Legacy exams default to an empty list, so the old-file restriction remains enabled. Approved reference files do not permit old answer uploads; create/save a new answer during the exam. The application's whitelist remains a separate setting.
- An old unauthorized file still emits `unauthorized_app` with severity 4 and evidence. Only a currently verified owning process may be terminated, with no name-wide `taskkill` fallback. Windows Recent observations without a verified process use `file_access_review_required`. This is an observation for review, not a guarantee the file is presently open. Closing a verified process can still close several documents in that same process.
- Candidate notices show closed vs review-only vs blocked upload accurately. External observations preserve an unrelated attached answer. Python-origin notices are not submitted a second time; scoring rules themselves are unchanged.
- YOLO input is aspect-preserving 640x640 letterboxing with corrected evidence coordinates. Phone/book continuity is independent and requires overlapping boxes. A possible phone triggers inference on the next camera frame: two consecutive phone predictions at confidence >=0.60 confirm it; weaker predictions and books require three checks. A missed detection or spatial jump resets confirmation, and the two-second repeat cooldown remains. Ordinary sampling stays every third frame. The model and minimum confidence threshold are unchanged. Books must still be interpreted according to exam policy; headphones are not detected by this COCO model.
- Voice rejects clipped/too-short segments without accumulating mismatch counts. Microphone failures appear in health and retry after one second. The 0.75 speaker cutoff, two mismatches and 60-second cooldown remain unchanged because no labelled real-room evaluation supports changing them yet. `python evaluate_voice.py --reference enrolled.wav --sample self.wav --speaker candidate --sample other.wav --speaker other` reports local WAV similarity and expected-label matches without uploading audio or altering thresholds. Compare Urdu/English, quiet/noisy rooms and microphone changes before choosing a cutoff/uncertain band. Neither VAD nor speaker similarity proves a second live person.
- Camera uniformity checks now include bright covers, use monotonic timing, and label the observation as possible obstruction/exposure. The legacy `variance` metric remains for compatibility and actually represents standard deviation; `standard_deviation` is also exposed.
- USB detection combines CIM's USB interface with Storage CIM USB-bus indices (MSFT_Disk BusType 7) for UASP devices. Existing CIM remains a fallback if Storage CIM is unavailable. Three-second polling is unchanged: short connections can still be missed and query time adds latency. Test an actual USB flash drive and SSD on the presentation laptop.

Additional checks: `node electron/check_file_notice.js` (candidate notice/answer preservation) and from `server`, `node check_file_policy.js` (validation, persistence, candidate lookup and legacy default). The full reliability check includes slow-backend durable acknowledgment, recovered alerts during self-check, startup and all 25 detector checks. Late-evidence and examiner-isolation checks remain passing. Real process termination, hardware reconnection, cloud storage and false-positive rates still require a practice exam.

The read-only USB query was exercised on the presentation laptop: the slow Get-Disk approach was replaced with direct CIM after exceeding five seconds. The final combined direct-CIM query completed in 0.52 seconds with no error and no external storage attached; no insertion/removal or UASP device was exercised. BusType mapping is documented at https://learn.microsoft.com/en-us/windows-hardware/drivers/storage/msft-disk.

## Forward-facing left-alert correction

The supplied false-positive image produced about +10.5 degrees raw PnP yaw, whereas the prior genuine profile image produced about +39.6 degrees. A biased neutral baseline could make a nearly frontal pose exceed the relative 13-degree threshold. Lateral classification now requires both raw and calibrated yaw to support a turn in the same direction; returning below the raw threshold clears it even if relative hysteresis would hold the alert. Raw, relative and neutral yaw are included in evidence details for diagnosis. This is deliberately conservative for off-axis camera setups and still requires room/laptop rehearsal; it is not a validated eye-gaze estimate.

Local repeated-frame replay verified no head alert on the supplied forward-facing image under a biased baseline, an alert on the supplied true turn, and no repeat alert after returning forward. The new deterministic regression covers the same calibration-bias/return behavior. Timing, thresholds, voice, object rules and risk scoring were not changed by this correction.
