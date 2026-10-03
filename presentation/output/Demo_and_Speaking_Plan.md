# Progress presentation and demo plan

Teacher schedule: Monday **5 October 2026, 4:00 PM**, Asia/Karachi. The upload instruction says **before Sunday 4 October**, so the conservative deadline is Saturday **3 October**; do not assume Sunday night is acceptable without clarification. Upload is the team's responsibility. No external upload was performed.

## Timing and team roles

Use slides 1-15 for approximately 5 minutes 30 seconds, demonstrate for 7 minutes 30 seconds, then reserve 3-7 minutes for questions. Slides 16-29 are backup detail and not part of the opening. Jump directly to a relevant module slide during Q&A rather than presenting every appendix slide.

Scope p. 13 assigns Umair to Electron/environment/evidence/submission, Usman to AI/self-check/scoring and Abubakar to backend/dashboard. Confirm these still reflect the team's actual work before presenting. The title slide uses the names and supervisor from scope p. 1.

| Opening | Time | Suggested presenter |
|---|---:|---|
| Title and problem (1–2) | 35 seconds | Umair |
| Objectives and scope (3) | 25 seconds | Umair |
| Architecture (4) | 35 seconds | Abubakar |
| Module overview and explanations (5–9) | 120 seconds | Usman |
| Candidate journey and review (10–11) | 40 seconds | Umair |
| Progress, additions and validation (12–14) | 60 seconds | Abubakar |
| Demo handoff (15) | 15 seconds | Umair |

Speaker notes contain short talking points and the evidence sources. Read them in PowerPoint before rehearsing; do not read every word on the slides aloud.

## Seven-and-a-half-minute demonstration

| Time | Action | Visible evidence |
|---|---|---|
| 0:00-0:50 | Examiner shows a prepared practice exam, allowed apps and PDF paper, then activates it | Exam configuration and active state |
| 0:50-2:15 | Candidate joins using the exam code, acknowledges consent and completes rehearsed self-check | Session, candidate details and checks. Updated consent covers voice profiles, suspicious clips and manual retention; use rehearsed team data for the demo |
| 2:15-2:50 | Show paper and type a short answer | Integrated workspace and local save indicator |
| 2:50-4:20 | Face forward briefly for baseline, then demonstrate one sustained head turn and a rehearsed phone observation | Event appears in examiner feed with candidate/exam identity and evidence |
| 4:20-5:20 | Open evidence, explain the score and dismiss one practice alert | Human review updates the evidence/score |
| 5:20-6:00 | Send a clarification or examiner message | Candidate receives the message |
| 6:00-7:00 | Submit typed answer and, if rehearsed, a prepared new attachment | Examiner opens the saved submission |
| 7:00-7:30 | Show historical summary and CSV/print options | Completed exam summary and reporting progress |

Keep voice, USB insertion, strict process termination, offline recovery and the admin console as optional Q&A demonstrations. They should replace a main step only after a successful rehearsal; do not add all of them to an eight-minute demo.

## Before connecting HDMI

- Formal dress, charged laptop, charger, HDMI cable/adapter and backup laptop.
- The projector is a second display. The current candidate self-check requires a single detected display, and adding one during an exam creates an alert. No configurable display exemption was found. Prefer projecting the examiner dashboard on one laptop while a second laptop runs the candidate app on the same network. Show the candidate workflow directly on that laptop or use a clearly labelled rehearsal recording. Test HDMI beforehand rather than silently bypassing the check.
- Start MongoDB/backend, then dashboard, then Electron. Confirm SERVER_URL and the teacher login. A student app using localhost cannot reach a server on another laptop through that address.
- Use a short practice exam with enough remaining time, a small PDF, saved test files, non-sensitive team data and an empty/reviewed practice feed.
- Avoid full-system updates or Python/package changes before the panel. Run `npm run check:reliability` from candidate-app.
- Open the final PPTX in PowerPoint and verify team names, title, notes and HDMI rendering. Keep a local copy on the backup laptop.
- Carry reliable internet/hotspot if needed. A local server/database can support a local-network demonstration, but central monitoring still requires connectivity.
- Capture an honest backup recording after a successful rehearsal. If hardware/network fails, explain the failure and show that recording with its date rather than pretending it is live.

## Questions to prepare for

**Does the system prove cheating?** No. It detects signals and preserves evidence for examiner judgment.

**Is AI trained by your team?** Current models are pretrained. The contribution is their integration, local execution, event reporting and examiner workflow. Evaluation recordings are for testing/tuning.

**Why did you change YOLOv8 to YOLO26?** The current repository uses YOLO26. Explain the actual team decision only if known; otherwise state that the scope/model documentation needs alignment. Do not invent a speed comparison.

**How accurate is it?** Deterministic behavior checks pass, but the planned labelled scenario study has not established the scope's accuracy targets. Say what remains to measure.

**What happens offline?** Electron persists accepted events and retries. The dashboard cannot receive live events without connectivity. Delayed events after server-side completion still require server handling improvements.

**Why use a risk score?** It helps prioritize review. Dismissed alerts are excluded, recency decays and a baseline retains accumulated events. It is not a probability of misconduct.

**What about privacy?** No continuous video upload. Evidence includes still images and, with the added voice feature, suspicious audio and stored speaker embeddings. Consent explicitly covers that addition and persistence until manual removal. There is no automatic expiry today.

**Is reporting complete?** Exam summaries, final scores, risk/violation breakdowns, CSV and browser Save PDF are implemented. Scope v3 does not demand an automatic PDF generator. A single export containing every alert log and screenshot remains an enhancement needed for full advanced-report content coverage; the evidence viewer currently opens separately and is excluded from print.

## Animated deck

Use `IntegrityFlow_Animated_Progress_Modules.pptx` for the latest local presentation. Slides 1–15 introduce the project and hand off to the demo; 16–29 are appendix material. Native fade transitions use click advancement, and 67 reveal groups introduce workflows and points in stages. Press Space/Right Arrow to reveal the next group; slides do not auto-advance. Rehearse in PowerPoint Slide Show before upload because static previews do not play animations. Earlier local decks and the Canva draft are older revisions.

Technical appendix: 16 privacy; 17 questions; 18 multiple-person detection; 19 head turns/face visibility; 20 phone/book detection; 21 camera darkness/obstruction; 22 voice verification; 23 application/USB/display checks; 24 evidence delivery and late recovery; 25 risk scoring/review; 26 exams/submissions/reports; 27 teacher access/admin; 28–29 UML. Speaker notes explain the implementation, tuning values, limits and source files. The multiple-person path counts faces through OpenCV or MediaPipe, whereas YOLO detects phone/book targets. Voice compares a speaker reference rather than counting speakers. Late evidence now works in controlled recovery checks; real database/cloud-network rehearsal remains.

**Have you reached 70%?** Present the module matrix and live workflow. Four of five core modules substantially match scope at code level, AI has partial scope coverage, and both optional modules have implementations. Overall percentage requires the supervisor's weighting and acceptance evidence.

Architecture on slide 4 now separates local monitors, Electron/disk queue, Express, MongoDB and evidence files. Slides 28–29 are editable UML sequence diagrams for live delivery/review and post-completion recovery. Use these during technical Q&A; the main presentation remains slides 1–15.


Module overview is slide 5: eight scope modules (five core, two optional, one advanced). Slides 6–9 explain two modules per slide, with a separate purpose, technology and output for each. Spend 20 seconds on the overview and about 25 seconds on each module slide. Keep the other opening slides brief to finish within six minutes.

