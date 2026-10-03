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

It checks actual physical-lab and online self-check startup, dynamic ports, process identity, the face endpoint, offline persistence and non-overlapping retries. Thirteen Python regression checks cover gaze baseline, object continuity and rule handling, class selection, real ONNX inference on a blank frame, multiple-person continuity, USB insertion, verified file enforcement, voice mismatch continuity and failed-camera health.

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

Lateral detection now uses a 0.8-second sustained window. MediaPipe yaw is configured at 18 degrees; OpenCV fallback instead uses an eye-offset threshold of 0.14 relative to its initial neutral baseline (it does not measure degrees). Sit facing the screen during initial observations. Camera framing and eye-cascade misses can still delay a turn classification.

Python alert transport has a bounded worker so network acknowledgments do not block camera/audio capture. Delivery logs show server acknowledgment time and event age. Dashboard alerts arrive through Socket.IO immediately after the server stores evidence and the violation; storage/network latency still contributes. Offline retry remains on its existing 12-second interval. The Python transport queue is in-memory, so abrupt process exit can lose events that have not yet reached Electron's durable queue.

Continuous voice now verifies three-second windows instead of waiting up to ten seconds. Two valid mismatches are still required; short speech can intentionally pass without an alert. Verification runs on a bounded worker so embedding computation cannot stop microphone reads. Very low-energy segments are ignored and evidence saving requires real PCM samples; failed evidence creation reports a monitoring error instead of emitting an alert with no clip. The 60-second cooldown remains. The fixed similarity threshold still requires real-room evaluation.

Existing local and server WAV files inspected during this review had valid headers and nonzero durations. A zero-duration player therefore does not by itself prove an empty recording: authorization, URL and loading failures must also be checked. Audio players now show a loading-failure message rather than leaving an unexplained player at zero. Existing files were not modified.
