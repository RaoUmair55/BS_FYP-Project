from pathlib import Path
from html import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader

ROOT = Path.cwd()
OUT = ROOT / 'output/pdf/IntegrityFlow_Module_Explanation_Guide.pdf'
styles = {
 'title': ParagraphStyle('title', fontName='Times-Bold', fontSize=25, leading=29, textColor=colors.HexColor('#203864'), spaceAfter=15),
 'heading': ParagraphStyle('heading', fontName='Times-Bold', fontSize=17, leading=21, textColor=colors.HexColor('#203864'), spaceAfter=10),
 'point': ParagraphStyle('point', fontName='Times-Bold', fontSize=11.2, leading=14, textColor=colors.HexColor('#203864'), spaceBefore=9, spaceAfter=4),
 'body': ParagraphStyle('body', fontName='Times-Roman', fontSize=10.5, leading=13.5, spaceAfter=4),
 'small': ParagraphStyle('small', fontName='Times-Roman', fontSize=9, leading=11.5, textColor=colors.HexColor('#45556C'), spaceAfter=4),
}
story=[]
def p(text, style='body'):
 return Paragraph(text, styles[style])
def add(text, style='body'):
 story.append(p(text,style))
def point(title, purpose, how, locations):
 items=[p(escape(title),'point'),p('<b>Purpose:</b> '+escape(purpose)),p('<b>How it works:</b> '+escape(how))]
 refs=[]
 for file, token in locations:
  source=(ROOT/file).read_text(encoding='utf-8')
  index=source.find(token)
  if index < 0:
   raise ValueError((file,token))
  line=source[:index].count('\n')+1
  refs.append(f'{file}:{line} - {token}')
 items.append(p('<b>Where to show it:</b> '+'<br/>'.join(escape(ref) for ref in refs),'small'))
 story.append(KeepTogether(items))

modules=[
('1. Secure Environment Enforcement',
 'I built the candidate-side environment controls: permitted tools remain usable, while prohibited applications and old documents generate evidence-backed enforcement events.',[
 ('Windows candidate desktop application using Electron.', 'Provide one desktop entry point for the exam and native Windows integration.', 'Electron main creates the window, starts Python and coordinates login, consent, self-check and exam mode. contextIsolation is enabled and nodeIntegration is disabled; preload exposes selected IPC methods.', [('candidate-app/electron/main.js','async function createWindow'),('candidate-app/electron/preload.js','contextBridge.exposeInMainWorld')]),
 ('Application whitelist enforcement with examiner-permitted tools and process monitoring.', 'Allow required exam software while restricting unrelated tools.', 'The teacher stores executable names with the exam. Python expands known app aliases and inspects candidate-owned processes. Protected OS/app processes are excluded. Allowed tools are inspected for old files; prohibited processes enter the enforcement handler.', [('candidate-app/ai-module/whitelist_enforcer.py','def _parse_allowed_apps'),('candidate-app/ai-module/whitelist_enforcer.py','def _monitor_loop')]),
 ('Clipboard and display restrictions, USB-storage monitoring and pre-existing-file checks.', 'Reduce copying and use of extra screens, external storage or prepared notes.', 'The renderer blocks clipboard actions and context menus; Electron clears the clipboard and monitors displays. Python detects USB disks, captures evidence and requests safe removal. An old document is identified using modification time and file/title/Recent observations; detection can close the allowed application.', [('candidate-app/renderer/examScreen.js',"['copy', 'cut', 'paste', 'contextmenu']"),('candidate-app/ai-module/whitelist_enforcer.py','def _inspect_allowed_app'),('candidate-app/ai-module/usb_monitor.py','def _eject_storage')]),
 ('Explicit permitted-file exceptions and online/physical-lab exam modes.', 'Permit approved material and adapt monitoring to the exam setting.', 'The old-file guard exempts normalized approved paths. Online mode starts camera and voice monitoring; physical-lab mode bypasses them while environment monitoring remains. APP_MODE=dev is a separate development setting.', [('candidate-app/ai-module/whitelist_enforcer.py','def _is_permitted_file'),('candidate-app/ai-module/main.py','if is_physical_lab:')]),
 ],'Permit Notepad; create a new file, then open an old unapproved file. Show the alert and application closure. Use a spare USB to demonstrate safe removal.',
 'Do not call this an unbreakable kiosk: the current window is not configured as a complete OS lockdown. File timestamps are a practical policy, not proof of content age. USB removal may be vetoed; app closure can discard other open documents.'),
('2. AI Monitoring',
 'The camera is processed locally. We report sustained visual events with evidence, rather than treating one uncertain frame as proof of cheating.',[
 ('Local webcam processing using OpenCV and MediaPipe face landmarks when available.', 'Measure camera events without uploading a continuous video stream.', 'OpenCV reads webcam frames. MediaPipe Tasks with a local face-landmarker model is preferred, with legacy FaceMesh and OpenCV Haar fallbacks. Landmark coordinates feed OpenCV pose estimation; a fallback has different accuracy.', [('candidate-app/ai-module/ai_monitor.py','class AIMonitor'),('candidate-app/ai-module/ai_monitor.py','def _check_head_pose')]),
 ('Head-turn, missing-face, multiple-face/person and camera-obstruction signals.', 'Flag sustained absence or an unusual camera scene.', 'Head pose uses six landmarks, solvePnP, geometry checks, a forward baseline and direction timers. Face counts have persistence checks. A separate lighting/occlusion detector evaluates darkness and image variation; additional person checks also use object inference.', [('candidate-app/ai-module/ai_monitor.py','def _observe_head_pose'),('candidate-app/ai-module/ai_monitor.py','def _record_face_count'),('candidate-app/ai-module/services/lighting_occlusion_detector.py','class CameraOcclusionDetector')]),
 ('YOLO26n ONNX inference for configured phone/book checks.', 'Detect selected prohibited visible objects.', 'ONNX Runtime executes the local model on CPU. Frames are resized/padded for inference, predictions are decoded and filtered by class/confidence. Spatial and repeated-frame checks suppress isolated detections; a candidate phone is checked again promptly.', [('candidate-app/ai-module/ai_monitor.py','def _check_objects')]),
 ('Calibration and confidence/persistence filters; alerts support examiner review.', 'Reduce transient false positives and make alerts reviewable.', 'A stable forward pose establishes a neutral baseline. Angle limits, confidence checks and sustained conditions precede an event. Each accepted signal gets a session, timestamp and supporting frame. The examiner may confirm or dismiss it.', [('candidate-app/ai-module/ai_monitor.py','def _track_head_direction'),('dashboard/src/components/AlertFeed.jsx','handleQuickReview')]),
 ],'Wait for the neutral-position calibration log, turn left/right, return forward, and show the resulting webcam evidence. Hold a phone in view and compare with an empty frame.',
 'Head direction is not precise eye-gaze tracking. The project runs pretrained models; do not claim custom model training or measured accuracy without your own test results. Headphones are not an implemented detection class.'),
('3. Evidence Capture & Delivery',
 'Every alert should explain what happened, when it happened and which candidate session it belongs to. Evidence and delivery are separate from scoring.',[
 ('Event-triggered desktop screenshots for system events and webcam frames for visual events.', 'Capture the right view for the event.', 'MSS captures the desktop for app/file/USB events. WebcamCaptureProvider saves the supplied camera frame for visual events. Desktop evidence cannot show the face scene; webcam evidence cannot establish which document was open.', [('candidate-app/ai-module/services/capture/__init__.py','def capture_screenshot'),('candidate-app/ai-module/services/capture/__init__.py','def capture_webcam_frame')]),
 ('Timestamped JPEG evidence linked to the candidate session and violation.', 'Keep evidence attributable and distinguish separate incidents.', 'Capture providers create timestamped JPEG names with session/type information. The event carries sessionId, eventId, timestamp, details and evidence paths. The server stores the file and records the stored URL on the violation.', [('candidate-app/ai-module/services/capture/MssCaptureProvider.py','def capture'),('server/src/routes/violations.js','Process screenshot file')]),
 ('Local durable queues, stable event IDs and retries through Python and Electron.', 'Preserve events through network failures and restarts.', 'Python persists events before handoff; Electron persists queued server uploads using SQLite or JSON fallback. Original timestamps and event IDs survive retry. The server recognizes duplicate delivery rather than creating another copy of the same event.', [('candidate-app/ai-module/services/violation_delivery.py','def enqueue'),('candidate-app/electron/ipc/violationBuffer.js','function enqueue'),('candidate-app/electron/ipc/pythonBridge.js','startBufferRetryLoop')]),
 ('Server evidence storage and retrieval, including valid delayed evidence after exam completion.', 'Allow review even when upload arrives late.', 'The storage service selects local or Cloudinary storage. Capture-time/session-window checks distinguish valid delayed events from invalid ones. receivedLate identifies late arrivals; late evidence needs explicit review before affecting risk. Protected evidence URLs are checked against teacher ownership/admin access.', [('server/src/routes/violations.js','receivedLate:'),('server/src/services/storage/index.js','module.exports'),('server/src/index.js',"app.use('/uploads'")]),
 ],'Generate an alert, briefly disconnect the server/network, show the queued count, restore connectivity and show delivery with the original timestamp. Explain the screenshot versus webcam frame.',
 'Queues improve resilience but are not an absolute guarantee against disk failure or missing evidence. Continuous video is not stored. Delayed alerts should not be presented as fresh live incidents.'),
('4. Candidate Self-Check System',
 'Self-check catches setup problems before an exam starts. It is a readiness workflow, not the same as continuous exam enforcement.',[
 ('Step-by-step camera/face calibration, microphone and reference-voice checks.', 'Verify that the candidate can be monitored with usable inputs.', 'The self-check screen opens the camera, checks centered face alignment and microphone input, and records a voice reference plus confirmation. This capture helps readiness; continuous head-pose calibration occurs when the exam camera monitor starts.', [('candidate-app/renderer/selfCheck.js','function startFaceAlignmentTracking'),('candidate-app/ai-module/voice_monitor.py','def set_reference_voice')]),
 ('Application, USB-storage and display verification before exam entry.', 'Find blocked software, external storage and extra monitors early.', 'The screen invokes preload methods checkApps, checkUsbDrives and getDisplayCount. The Begin button depends on all required checks passing. Self-check lists USB devices; ejection/enforcement occurs during an active exam.', [('candidate-app/renderer/selfCheck.js','function updateBeginButton'),('candidate-app/electron/preload.js','checkUsbDrives:')]),
 ('Physical-lab mode bypasses camera and voice checks.', 'Avoid treating a supervised shared lab as a private online camera/audio environment.', 'The selected exam type controls which checks are required. Python also bypasses the corresponding camera and voice monitors in physical_lab mode, so the bypass is not just a cosmetic UI change.', [('candidate-app/renderer/selfCheck.js','physical_lab'),('candidate-app/ai-module/main.py','if is_physical_lab:')]),
 ],'Open self-check with an extra display or USB attached and show the failed readiness check. Remove it, rerun the check and explain how Begin becomes available.',
 'Removing the standalone voice module from the form did not remove voice-related self-check code or the voice feature. The form still mentions microphone/reference voice here; explain this honestly if asked.'),
('5. Violation Severity Scoring Engine',
 'The server converts eligible violation records into a review-priority score. It helps the examiner choose whom to inspect first; it is not a verdict.',[
 ('Server-side severity weighting and time-decayed aggregation of violation records.', 'Combine severity and recency into a consistent session score.', 'The engine fetches eligible violations and calls DecayScoringStrategy. Recent weight decays exponentially with an approximately 30-minute half-life. A persistent baseline means past eligible violations do not simply vanish. The result is normalized and capped at 100.', [('server/src/scoring/severityEngine.js','calculateRiskScore'),('server/src/services/scoring/DecayScoringStrategy.js','calculateScore')]),
 ('Per-candidate risk score and examiner review priority.', 'Direct attention to candidates with more concerning records.', 'Scores are associated with the candidate session. The risk-score endpoint and socket updates supply dashboard badges; Priority Queue lists unreviewed events across active exams. Event severity and candidate risk are distinct values.', [('server/src/routes/riskScore.js',"router.get('/:sessionId'"),('dashboard/src/components/RiskScoreBadge.jsx','RiskScoreBadge'),('dashboard/src/components/PriorityQueue.jsx','export default function PriorityQueue')]),
 ('Review decisions affect scoring; risk is not a probability of cheating.', 'Let human decisions remove unsupported signals.', 'Dismissed records are excluded by the engine; eligible confirmed/pending events follow its scoring rules. Late evidence needs explicit confirmation to score. Review actions trigger updated records and score broadcasts. A score of 80 is not an 80% cheating probability.', [('server/src/scoring/severityEngine.js','dismissed'),('server/src/routes/violations.js','/review')]),
 ],'Show a candidate score, dismiss a relevant event and show the changed score. Use an isolated demo session so other violations do not obscure the change.',
 'Visual grouping combines repeated alerts for easier reading; it does not automatically group them in the scoring engine. Do not say incident-level score deduplication is implemented.'),
('6. Examiner Dashboard & Exam Management',
 'The dashboard joins exam management with live human review. Live Monitoring and History serve different stages of the exam lifecycle.',[
 ('Create/manage exams, release papers and configure rules and permitted applications.', 'Give the examiner control over the exam environment and start flow.', 'ExamManager submits the creation form with title, duration, type, paper and rules. The server persists the exam and code. Paper release changes the candidate lobby/workspace state; End Exam updates the exam and active session records.', [('dashboard/src/components/ExamManager.jsx','Create Exam Modal'),('server/src/routes/exams.js',"router.patch('/:examId/status'"),('server/src/routes/exams.js','release-paper')]),
 ('Live Monitoring, Active Candidates, Priority Queue and exam-scoped evidence review.', 'Separate urgent review from management/history.', 'Dashboard maintains the exam/candidate selection. Active-exam filtering excludes completed exams. StudentList presents candidates; AlertFeed follows the selected session; PriorityQueue supports cross-candidate triage; EvidenceViewer retrieves a session history.', [('dashboard/src/pages/Dashboard.jsx','selectLiveAlerts'),('dashboard/src/components/AlertFeed.jsx','selectLiveAlerts'),('dashboard/src/components/EvidenceViewer.jsx','EvidenceViewer')]),
 ('Socket.IO updates restricted by examiner ownership/admin access.', 'Deliver live updates without exposing another teacher\'s exam.', 'The socket layer resolves an event\'s exam and emits only to the owning teacher and authorized admins. The dashboard subscribes to violations and score/review updates, while REST fetches supply initial state and refreshes.', [('server/src/sockets/violationSocket.js','broadcastToExam'),('dashboard/src/hooks/useSocket.js',"socket.on('violation'")]),
 ('Confirm/dismiss alerts, review submissions and inspect historical exams.', 'Keep an auditable human decision process.', 'AlertFeed calls the protected review endpoint with decision/note. Session submissions and evidence remain available through review screens. History opens completed-exam summaries, candidate rosters and exports.', [('dashboard/src/components/AlertFeed.jsx','handleQuickReview'),('dashboard/src/components/ExamSummary.jsx','ExamSummary'),('server/src/routes/submissions.js','requireOwnedSession')]),
 ],'Select an active exam and student, review an alert, end the exam using the confirmation dialog, then open History and inspect its summary.',
 'Teacher-facing access depends on authentication and ownership checks. The candidate code-lookup endpoint is a different entry flow; it is not the route used by the fixed Live End Exam action.'),
('7. Answer Submission System',
 'The candidate views the released paper, prepares text or a file answer, then receives completion only after the server accepts the submission.',[
 ('Candidate paper viewing, typed answers and supported file uploads.', 'Support both written responses and practical work files.', 'The renderer fetches the paper through the session-aware paper endpoint. PDF uses a viewer; DOCX uses Mammoth. Text and the selected file are placed in FormData and posted to /submissions. The server stores the answer and optional file.', [('candidate-app/renderer/examScreen.js','async function loadExamPaper'),('candidate-app/renderer/examScreen.js','async function performSubmission'),('server/src/routes/submissions.js',"router.post('/'")]),
 ('Local text drafts, exam timing and submission controls.', 'Reduce lost typing and enforce the exam workflow.', 'Text input writes a session-scoped localStorage draft. The countdown uses server endTime plus server-time offset and accepts extensions. Manual submission shows a confirmation; expiry attempts automatic submission. Duplicate clicks are guarded and failures allow retry.', [('candidate-app/renderer/examScreen.js','function saveDraft'),('candidate-app/renderer/examScreen.js','serverTimeOffset'),('candidate-app/renderer/examScreen.js','submissionInFlight')]),
 ('Answers linked to the candidate session; examiner retrieval and download.', 'Keep the correct answer with the correct candidate/exam.', 'The server validates sessionId, active state, text length, timing and duplicate submission. File size is limited to 15 MB. Storage URLs and submission metadata are saved against the session, and protected examiner endpoints retrieve/download them.', [('server/src/routes/submissions.js','fileSize: 15'),('server/src/routes/submissions.js','Submission.exists'),('server/src/routes/submissions.js','requireOwnedSession')]),
 ],'Type an answer and refresh to restore the draft. Attach a newly created file, submit, and show its record/download in examiner review.',
 'The old-file upload timestamp check is candidate-side. A locally saved draft is not a server submission; attached files are not automatically restored across app restarts. Answer submission is separate from offline alert buffering.'),
('8. Audit Report / Exam Summary',
 'After an exam, the examiner can inspect the candidate roster, score distribution and summary, export structured data or print the report.',[
 ('Historical exam summaries, final risk scores and violation/risk distributions.', 'Summarize a completed exam for review and reporting.', 'The summary endpoint aggregates sessions and violations for the owned exam. ExamSummary displays totals, candidate risks and distribution charts. Scores are computed/stored by the scoring workflow; a final score is still a review metric.', [('server/src/routes/exams.js',"router.get('/:examId/summary'"),('dashboard/src/components/ExamSummary.jsx','Risk distribution calculation')]),
 ('CSV export and browser print/Save PDF.', 'Provide portable structured and printable results.', 'handleExportCSV builds a CSV download from the roster/summary data. The print action calls window.print(); browser print styles prepare the report and the user can select Save as PDF. It is not a dedicated server-generated PDF pipeline.', [('dashboard/src/components/ExamSummary.jsx','const handleExportCSV'),('dashboard/src/components/ExamSummary.jsx','window.print()')]),
 ('Detailed alert logs and screenshots remain in the separate evidence viewer; an all-evidence export is remaining work.', 'Distinguish implemented reports from a complete evidence package.', 'Individual session evidence is accessible through EvidenceViewer and authenticated stored assets. The summary export does not assemble every screenshot/audio clip into one bundled archive/report. This is a scope boundary, not a missing summary feature.', [('dashboard/src/components/EvidenceViewer.jsx','EvidenceViewer'),('server/src/index.js',"app.use('/uploads'")]),
 ],'Open a completed exam, point to its totals and candidate roster, export CSV, then open the print preview. Open candidate evidence separately.',
 'Do not promise an automatically generated PDF containing all event screenshots or an all-evidence ZIP. The existing CSV and browser print features are implemented.'),
('9. Authentication & Administration',
 'Teacher accounts and exam ownership checks protect the dashboard. Administrators have additional account, asset and audit-management screens.',[
 ('Teacher/admin authentication, account verification/reset and role/ownership checks.', 'Identify users and restrict privileged data/actions.', 'Passwords use bcrypt; login issues an access token and a refresh cookie. Verification currently uses the link strategy. Protected routes apply authentication and exam/session ownership checks. Admin routes require admin access. Reset/verification flows use the configured mail service.', [('server/src/routes/auth.js','bcrypt.hash'),('server/src/services/verification/index.js','new LinkVerificationStrategy'),('server/src/middleware/examAccess.js','requireOwnedExam')]),
 ('Administrative user/asset management and activity audit records.', 'Support controlled maintenance and accountability.', 'Admin views call endpoints for users, role changes, stored assets and audit logs. Asset deletion removes/unlinks supported files; auditLogger records selected examiner/admin actions. AuditLogView displays/filter/exports activity records.', [('server/src/routes/admin.js',"router.get('/users'"),('server/src/routes/admin.js',"router.get('/assets'"),('server/src/utils/auditLogger.js','logTeacherAction')]),
 ('Teacher information and consistent light/dark dashboard themes.', 'Make the interface identifiable and usable across lighting conditions.', 'AuthContext supplies teacher identity to the header/account area. App-level theme state and CSS variables drive light/dark surfaces and shared components; the controls propagate the selected theme to dashboard screens.', [('dashboard/src/context/AuthContext.jsx','teacher'),('dashboard/src/App.jsx','theme')]),
 ],'Log in as a teacher, show the account identity and theme switch, then explain admin-only user/assets/audit screens using an authorized admin account.',
 'The current mail service is Ethereal, a development/test mail provider. Do not claim production email delivery. An audit log records implemented actions, not every possible OS activity.'),
('10. Examiner-Candidate Communication',
 'The examiner can communicate instructions and manage a candidate session while the candidate remains inside the exam workflow.',[
 ('Exam chat, broadcasts and examiner warnings.', 'Let candidates ask questions and receive examiner instructions.', 'LiveExamChat and the candidate chat UI use the messages routes for session conversations and broadcasts. Examiner warnings are stored on the session; status polling detects new warnings and displays a candidate toast.', [('dashboard/src/components/LiveExamChat.jsx','LiveExamChat'),('server/src/routes/messages.js','router.'),('candidate-app/renderer/examScreen.js','showExaminerWarningToast')]),
 ('Session termination and time-extension controls.', 'Allow the examiner to stop a session or grant extra time.', 'The protected termination endpoint marks a candidate terminated and saves a reason. The renderer observes that state and displays termination handling. Exam extensions update endTime; polling adjusts the candidate countdown and displays an extension notification.', [('server/src/routes/sessions.js',"router.post('/:sessionId/terminate'"),('server/src/routes/exams.js','extend-time'),('candidate-app/renderer/examScreen.js','handleSessionTerminated')]),
 ('Candidate status updates and re-verification requests during the exam.', 'Keep the candidate synchronized with examiner decisions.', 'The candidate polls session status about every three seconds for paper release, warnings, timing and camera verification. A rejected/flagged/re_verify state opens the camera re-verification modal and permits a replacement image workflow.', [('candidate-app/renderer/examScreen.js','function startSessionStatusPolling'),('candidate-app/renderer/examScreen.js','async function showCameraReverificationModal'),('server/src/routes/sessions.js',"router.patch('/:sessionId/camera-verification'")]),
 ],'Send a warning and show it on the candidate screen, extend time and show the timer change, then demonstrate re-verification or terminate a disposable demo session.',
 'Candidate updates are partly polling-based and can be delayed by the poll interval or network failure. End Exam and individual candidate termination are distinct actions. Connected confirms server reachability, not every detector\'s health.'),
]

add('IntegrityFlow<br/>Module Explanation Guide','title')
add('Panel preparation for Rao Umair Ahmed','heading')
add('A companion to the revised 10-module form. Prepared from the current source code on 7 October 2026. This guide explains the form; it does not change the implementation.')
add('How to answer a panel question','point')
add('Use four steps: explain the purpose, trace the workflow, point to the code, and show a small demonstration. Use the exact claim boundaries on each module page when an evaluator asks about guarantees.')
add('Overall architecture','point')
add('Candidate renderer &lt;- Electron IPC through preload.js -&gt; Electron main process &lt;- localhost HTTP on dynamic ports -&gt; Python monitors. Events and evidence are persisted locally and sent to the central Node/Express server. MongoDB stores session/event records; storage providers hold files. Socket.IO and REST connect the server to the examiner dashboard. Answer submission is a separate renderer-to-server request.')
add('Your assigned responsibility','point')
add('Rao Umair Ahmed: desktop app and environment control, evidence capture, answer submission, and the shared Electron-Python bridge. Understand how AI and backend/dashboard modules connect to your work; detailed model/scoring ownership can be shared with the assigned teammate.')
add('Important distinctions','point')
for t in ['An exam is the teacher-created assessment; a session is one candidate\'s participation. An event belongs to that session.',
          'Desktop screenshots show software activity; webcam frames show the camera scene. An audio clip is separate event evidence.',
          'A detection is a review signal. Severity is an event weight; risk is a candidate review score, not a cheating probability.',
          'Physical-lab mode is not development mode. Self-check is not continuous enforcement.',
          'Removing the standalone voice module from the form did not remove its implementation or the remaining voice references in self-check.']:
 add('- '+escape(t))
add('Code references','point')
add('Paths are relative to D:\\BS_FYP Project\\IntegrityFlow. Each file:line points to a relevant function or route in the current working tree. Line numbers can move after edits. No secrets or credentials are included.','small')

for title, answer, points, demo, limit in modules:
 story.append(PageBreak())
 add(escape(title),'heading')
 add('<b>Say to the panel:</b> '+escape(answer))
 for item in points: point(*item)
 add('Demonstration / example','point');add(escape(demo))
 add('Claim boundary - explain accurately','point');add(escape(limit))

def footer(c,doc):
 c.setStrokeColor(colors.HexColor('#CFD7E2'));c.line(42,40,553,40)
 c.setFont('Times-Roman',9);c.setFillColor(colors.HexColor('#45556C'))
 c.drawString(42,27,'IntegrityFlow | Module defense companion')
 c.drawRightString(553,27,f'Page {doc.page}')
OUT.parent.mkdir(parents=True,exist_ok=True)
SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),leftMargin=42,rightMargin=42,topMargin=43,bottomMargin=52,
 title='IntegrityFlow - Module Explanation Guide',author='IntegrityFlow Project Team').build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(OUT)
assert len(reader.pages)==11, f'Unexpected overflow: {len(reader.pages)} pages'
text='\n'.join(page.extract_text() for page in reader.pages)
for title,*_ in modules: assert title in text,title
print(f'Created {OUT}; {len(reader.pages)} pages; all ten modules verified.')

