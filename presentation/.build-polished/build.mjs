import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
import { resolvePresentationFont, applyPresentationChartFont } from 'file:///C:/Users/Rao%20Umair/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations/container_tools/artifact_tool_utils.mjs';

const root='D:/BS_FYP Project/IntegrityFlow';
const dir=path.join(root,'presentation/.build-polished');
const family=resolvePresentationFont();
await fs.writeFile(path.join(dir,'font-policy.json'),JSON.stringify({basis:'design',families:[family]}));
console.log('FONT',family);
const p=Presentation.create({slideSize:{width:1280,height:720}});
const C={navy:'#081321',ink:'#132D3A',teal:'#087F8C',mint:'#5DE2CD',paper:'#F5F7F5',muted:'#526573',white:'#FFFFFF',line:'#B8C9CD',amber:'#F0BD69',blue:'#448CDD'};
const art=await fs.readFile('C:/Users/Rao Umair/.codex/generated_images/01a0ee05-2a4d-7073-bf8b-4c4b4cb18b0a/exec-8b53a55d-cf46-406f-9475-ccb8946b80c5.png');
let i=0;
function text(s,txt,x,y,w,h,size=26,color=C.ink,bold=false,group=0){
 const sh=s.shapes.add({geometry:'textbox',name:group?`reveal-${group}`:'fixed',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=txt;sh.text.style={typeface:family,fontSize:size,color,bold,autoFit:'none'};return sh;
}
function base(title,{dark=false,background=false,notes=''}={}){
 const s=p.slides.add();i++;s.background.fill=dark?C.navy:C.paper;
 if(background)s.images.add({blob:art,contentType:'image/png',position:{left:0,top:0,width:1280,height:720},fit:'cover',alt:'Abstract glass lens background'});
 if(title)text(s,title,64,48,1152,105,44,dark?C.white:C.ink,true);
 text(s,String(i).padStart(2,'0'),1150,665,65,30,18,dark?'#A1BDC5':C.muted);
 s.speakerNotes.textFrame.setText(notes);return s;
}
function topic(s,num,title,body,x,y,w=535,g=1,dark=false){
 text(s,num,x,y,w,32,22,dark?C.mint:C.teal,true,g);
 text(s,title,x,y+42,w,55,34,dark?C.white:C.ink,true,g);
 text(s,body,x,y+112,w,180,27,dark?'#D6E3E7':C.muted,false,g);
}
function node(s,label,x,y,w=245,h=82,g=1,dark=false){
 const sh=s.shapes.add({geometry:'rect',name:`reveal-${g}`,position:{left:x,top:y,width:w,height:h},fill:dark?'#102A3A':'#E3EFED',line:{fill:dark?'#37616C':C.line,width:1}});
 sh.text=label;sh.text.style={typeface:family,fontSize:24,color:dark?C.white:C.ink,bold:true,alignment:'center',verticalAlignment:'middle'};return sh;
}
function connect(s,a,b,g=1){const sh=s.shapes.connect(a,b,{kind:'straight',fromSide:'right',toSide:'left',line:{fill:C.teal,width:2},tail:{type:'arrow',width:'med',length:'med'}});sh.name=`reveal-${g}`;return sh;}
function flow(s,labels){const nodes=labels.map((label,k)=>node(s,label,64+k*400,532,350,70,3));connect(s,nodes[0],nodes[1],3);connect(s,nodes[1],nodes[2],3);}
function table(s,values,x,y,w,h,widths,font=23){
 const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});
 t.borders.assign({fill:C.paper,width:1,style:'solid'});
 for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){
  const cell=t.getCell(r,c);cell.fill=r===0?C.ink:(r%2?'#E5EEEC':C.paper);
  cell.text.style={typeface:family,fontSize:font,color:r===0?C.white:C.ink,bold:r===0};
 }
 return t;
}
const src=(files)=>'Code evidence: '+files.map(f=>root+'/'+f).join('\n');

// 1
let s=base('',{dark:true,background:true,notes:'15 seconds. Introduce the team and project. Vision and voice inference run on the candidate device. The examiner reviews events centrally. Team metadata preserved from the previous project deck. Presentation date: 5 October 2026.'});
text(s,'IntegrityFlow',64,156,900,108,80,C.white,true);
text(s,'Exam monitoring with local AI\nand system controls',68,290,800,130,40,'#D8F2EC',false,1);
text(s,'BSCS Final Year Project\nProgress presentation  /  5 October 2026',68,450,820,75,25,'#D0DEE5');
text(s,'Rao Umair Ahmed   ·   Muhammad Usman\nMuhammad Abubakar Siddique\nSupervisor: Mr. Abdullah',68,568,850,95,22,'#C1D5DD');

// 2
s=base('The examination environment needs more visibility',{notes:'20 seconds. Explain the problem using concrete examples. An examiner needs evidence from the candidate environment and a way to act on it. Avoid claiming that other proctoring systems universally lose data or require a particular bandwidth.'});
topic(s,'01','Beyond the camera','Unauthorized applications, pre-existing files, removable storage and extra displays can affect an exam.',64,205,535,1);
topic(s,'02','Beyond a single alert','Head movement and speech can be innocent. Examiners need context, evidence and control over the final decision.',670,205,535,2);
text(s,'Project objective: preserve useful signals for examiner review',64,588,1140,60,32,C.teal,true,3);

// 3
s=base('Scope and objectives',{notes:'20 seconds. Remote online exams use camera and voice monitoring plus system checks. Physical-lab mode deliberately bypasses camera/voice and retains environment monitoring. The project uses pretrained models, with integration and reliability engineering as our contribution. Do not claim measured FPS, CPU or AI accuracy. '+src(['candidate-app/electron/main.js','candidate-app/ai-module/main.py','candidate-app/ai-module/ai_monitor.py'])});
topic(s,'SCOPE','Two examination modes','Online exams: local vision and voice monitoring\n\nPhysical lab: system and peripheral controls',64,195,535,1);
topic(s,'OBJECTIVES','A complete review workflow','Secure exam entry and answer submission\n\nCapture evidence and recover offline events\n\nGive examiners timely review tools',670,195,535,2);

// 4
s=base('System architecture',{notes:'25 seconds. Read left to right. Python performs local monitoring and durably queues events in SQLite. Electron persists accepted events in its disk queue and forwards them. Express commits metadata to MongoDB and saves media using the configured storage provider. Authorized Socket.IO recipients receive updates. The Python control API and Electron receiver use separate dynamic loopback ports. No fixed 8766 FastAPI claim. '+src(['candidate-app/ai-module/main.py','candidate-app/ai-module/services/violation_delivery.py','candidate-app/electron/ipc/violationBuffer.js','server/src/routes/violations.js','server/src/sockets/violationSocket.js'])});
text(s,'Candidate workstation',64,190,535,40,27,C.teal,true);
text(s,'Central review',670,190,535,40,27,C.teal,true);
const a=node(s,'Python monitors\nVision / voice / OS',64,267,250,100,1);
const b=node(s,'Electron app\nKiosk / IPC / queue',364,267,250,100,2);
const c=node(s,'Express server\nValidation / scoring',664,267,250,100,3);
const d=node(s,'React dashboard\nExaminer review',964,267,250,100,4);
connect(s,a,b,2);connect(s,b,c,3);connect(s,c,d,4);
text(s,'SQLite event spool',64,392,250,60,23,C.muted,false,1);
text(s,'Disk-backed retry queue',364,392,260,60,23,C.muted,false,2);
text(s,'MongoDB + media storage',664,392,300,60,23,C.muted,false,3);
text(s,'Owner / admin sockets',964,392,250,60,23,C.muted,false,4);
text(s,'Local inference. Event-triggered evidence. Central examiner decisions.',64,565,1150,72,32,C.ink,true);

// 5
s=base('Eight modules in the project scope',{notes:'20 seconds. Five core modules, two optional modules and one advanced reporting module. All have implementation paths, but that count is not an independently assessed completion percentage. Module categories come from Scope v3 and presentation/output/Scope_Progress_Verification.md. Current code corrects older backend descriptions.'});
table(s,[['MODULE','SCOPE CATEGORY'],['1  Secure environment','Core'],['2  AI monitoring','Core'],['3  Evidence capture','Core'],['4  System self-check','Optional'],['5  Severity scoring','Optional'],['6  Examiner dashboard','Core'],['7  Answer submission','Core'],['8  Audit reporting','Advanced']],64,180,1150,450,[800,350],25);

// 6
s=base('Exam entry and environment controls',{notes:'25 seconds. Explain modules 1 and 4. Electron kiosk controls and psutil allowlists restrict the environment. Verified file ownership lets enforcement target the offending process. USB storage checks use Windows CIM, including USB bus type where available. Display count checks require one display. Self-check verifies actual hardware and voice enrollment before online exam entry. An allowlist is not a complete OS sandbox, and detection does not mean USB devices are disabled at driver level. '+src(['candidate-app/ai-module/whitelist_enforcer.py','candidate-app/ai-module/usb_monitor.py','candidate-app/renderer/selfCheck.js','candidate-app/electron/main.js'])});
topic(s,'MODULE 1 / CORE','Secure environment','Electron kiosk and shortcut controls\npsutil application and file checks\nWindows CIM USB storage checks\nSingle-display entry requirement',64,190,535,1);
topic(s,'MODULE 4 / OPTIONAL','System self-check','Camera, microphone and face readiness\nEnrollment plus voice confirmation\nExam rules and permitted applications\nHealth diagnostics before entry',670,190,535,2);
flow(s,['Exam rules','Local readiness checks','Entry and enforcement']);

// 7
s=base('Local vision and voice monitoring',{dark:true,notes:'30 seconds. Module 2. Modern MediaPipe Tasks supplies facial landmarks. OpenCV solves head pose using six selected landmark points. Sustained, calibrated head direction generates a signal, not measured eye gaze. YOLO26n runs through ONNX Runtime and targets phone/book classes. Face counts come from MediaPipe or OpenCV fallback, not YOLO phone inference. WebRTC VAD Mode 2 gates speech, then Resemblyzer compares it with the enrolled reference. Two valid mismatches trigger an event. False-positive and missed-detection rates remain to measure. '+src(['candidate-app/ai-module/ai_monitor.py','candidate-app/ai-module/voice_monitor.py'])});
text(s,'MODULE 2 / CORE',64,165,650,35,23,C.mint,true);
const v1=node(s,'Webcam frames',64,240,250,90,1,true),v2=node(s,'MediaPipe + OpenCV\nHead pose / face count',370,240,350,90,1,true),v3=node(s,'YOLO26n + ONNX\nPhone / book',777,240,430,90,1,true);
connect(s,v1,v2,1);connect(s,v2,v3,1);
const au1=node(s,'Microphone audio',64,405,250,90,2,true),au2=node(s,'WebRTC VAD\nSpeech gating',370,405,350,90,2,true),au3=node(s,'Resemblyzer\nReference similarity',777,405,430,90,2,true);
connect(s,au1,au2,2);connect(s,au2,au3,2);
text(s,'Temporal checks reduce brief alerts. Examiners review the evidence.',64,575,1150,75,30,C.white,true,3);

// 8
s=base('Evidence and review priority',{notes:'25 seconds. Modules 3 and 5. Vision events save annotated webcam JPEGs, environment events capture screenshots, voice events save valid WAV clips. Durable queues preserve event identity for retry deduplication. Weighted severity and decay form the score, with dismissed events excluded and late evidence held outside normal scoring until examiner confirmation. Risk is review priority. Do not call it a cheating probability. '+src(['candidate-app/ai-module/services/capture','candidate-app/ai-module/services/violation_delivery.py','server/src/services/scoring/DecayScoringStrategy.js','server/src/routes/violations.js'])});
topic(s,'MODULE 3 / CORE','Evidence capture','Annotated webcam stills\nEnvironment screenshots\nSuspicious audio clips\nDurable event IDs and retry queues',64,190,535,1);
topic(s,'MODULE 5 / OPTIONAL','Severity scoring','Severity weights and recency decay\nExam-scoped review priority\nDismissed events excluded\nLate evidence needs confirmation',670,190,535,2);
flow(s,['Monitoring event','Evidence and priority','Examiner decision']);

// 9
s=base('Examiner review and answer submission',{notes:'25 seconds. Modules 6 and 7. Live Monitoring prioritizes active-exam events and keeps evidence inside the selected exam. Exams defaults to Active, History exposes completed summaries, Account holds teacher controls. The teacher can review events, warn candidates or terminate sessions. Candidate workspace supports paper viewing, typed drafts and answer files. Rehearse actual submission and retrieval. '+src(['dashboard/src/pages/Dashboard.jsx','dashboard/src/components/ExamManager.jsx','candidate-app/renderer/examScreen.js','server/src/routes/submissions.js'])});
topic(s,'MODULE 6 / CORE','Examiner dashboard','Live Monitoring and priority queue\nEvidence review and risk badges\nExam management and history\nWarnings, chat and termination',64,190,535,1);
topic(s,'MODULE 7 / CORE','Answer submission','Integrated exam paper workspace\nTyped answers with local drafts\nSession-linked file upload\nTeacher viewing and download',670,190,535,2);
flow(s,['Configured exam','Candidate workspace','Submission and review']);

// 10
s=base('Reporting and additions beyond the scope',{notes:'25 seconds. Reporting is already implemented. Module 8 provides historical summaries, risk distributions, violation breakdowns, CSV and browser Save PDF. Exporting every individual alert and screenshot in one consolidated report remains incomplete. Additions include speaker verification, physical-lab mode, two-way intervention, admin asset management, multiple-exam lifecycle, dark mode and more durable transport. '+src(['dashboard/src/components/ExamSummary.jsx','dashboard/src/components/AdminDashboard/AdminDashboard.jsx','server/src/routes/exams.js'])});
topic(s,'MODULE 8 / ADVANCED','Audit reporting','Historical exam summaries\nRisk and violation breakdowns\nCSV export and browser Save PDF\nDetailed evidence opens separately',64,190,535,1);
topic(s,'ADDITIONAL WORK','Beyond the original baseline','Voice verification and consent\nPhysical-lab mode and chat\nAdmin accounts and asset management\nMultiple exams, dark mode and recovery',670,190,535,2);
flow(s,['Completed exam','Summary and exports','Institutional review']);

// 11
s=base('Reported load test: 50 simulated candidates',{notes:'30 seconds. Source: user-supplied before/after benchmark narrative on 3 October 2026. Reported after-run command: python scripts/load_test.py --students 50 --duration 20 --with-reads. Two simulated dashboard polling workers, synthetic violation HTTP traffic. Raw logs, hardware, database placement and repeat-run variation were not supplied. Overall request success includes endpoint responses, not verified socket delivery or evidence playback. Before throughput and request count imply about 24 seconds; after imply 20 seconds, so do not frame the throughput increase as proven capacity. No fresh benchmark was run for this deck. '+src(['scripts/load_test.py','server/src/routes/violations.js'])});
text(s,'Average HTTP latency',64,174,710,40,26,C.muted);
const ch=s.charts.add('bar',{position:{left:54,top:232,width:760,height:360},categories:['Before','After'],series:[{name:'Latency (ms)',values:[4142.10,408.76],valuesFormatCode:'0.00',fill:C.teal}],barOptions:{direction:'column',grouping:'clustered',gapWidth:120},hasLegend:false,chartFill:C.paper,plotAreaFill:C.paper,xAxis:{textStyle:{fontSize:24,fill:C.ink},line:{fill:C.line,width:1}},yAxis:{min:0,max:5000,numberFormatCode:'0" ms"',textStyle:{fontSize:18,fill:C.muted},majorGridlines:{fill:'#D6E0DE',width:1}},dataLabels:{showValue:true,position:'outEnd',textStyle:{fontSize:24,fill:C.ink},},});
applyPresentationChartFont(ch,{fontFamily:family});
text(s,'10.1×',868,237,335,110,74,C.teal,true,1);
text(s,'lower average latency',868,345,335,60,26,C.muted,false,1);
text(s,'100%',868,447,335,95,64,C.ink,true,2);
text(s,'request success in the\nreported after-run',868,535,335,75,24,C.muted,false,2);
text(s,'Short synthetic HTTP benchmark supplied by the team. AI accuracy and end-to-end delivery were not measured.',64,636,1120,45,18,C.muted);

// 12
s=base('The ingestion pipeline now acknowledges before scoring',{notes:'25 seconds. Code confirms res.status(201).json(savedViolation) after database commit and before setImmediate processing. This removes scoring from the response critical path. setImmediate defers execution but is not a worker thread or durable background job and does not make MongoDB queries free. Original awaited database calls were asynchronous, not synchronous CPU blockage. The reported benchmark supports HTTP latency improvement, not a less-than-25ms guarantee. '+src(['server/src/routes/violations.js:148','server/src/scoring/severityEngine.js'])});
text(s,'Before: response waits for analytics',64,184,1100,40,27,C.muted,true,1);
const old1=node(s,'Save violation',64,247,245,80,1),old2=node(s,'Calculate risk',364,247,245,80,1),old3=node(s,'Broadcast + respond',664,247,350,80,1);
connect(s,old1,old2,1);connect(s,old2,old3,1);
text(s,'Current: respond after a successful commit',64,385,1100,42,27,C.teal,true,2);
const new1=node(s,'Save violation',64,448,245,80,2),new2=node(s,'HTTP 201',364,448,245,80,2),new3=node(s,'Deferred broadcast\nand risk update',664,448,350,80,3);
connect(s,new1,new2,2);connect(s,new2,new3,3);
text(s,'Faster acknowledgement does not guarantee faster examiner delivery',64,596,1140,55,28,C.ink,true);

// 13
s=base('Current implementation progress',{notes:'25 seconds. All eight scope modules have code paths. Reporting is present. Exact AI scope coverage is partial because headphones are not detected and model/quantization differ from the proposal. We do not assign an invented 78% completion number. A supervisor-approved weighted rubric and live acceptance tests are needed for a defensible overall percentage. Controlled detector regression suite passed 25 checks in the preceding monitoring work. '+src(['presentation/output/Scope_Progress_Verification.md','candidate-app/RELIABILITY.md','candidate-app/ai-module/check_detection.py'])});
table(s,[['AREA','IMPLEMENTED','REMAINING ACCEPTANCE'],['Core workflow','Entry, monitoring, review, submission','Full laptop / network rehearsal'],['AI monitoring','Face, head pose, phone/book, voice','False alerts / missed detections'],['Reliability','Durable retries and late evidence','Hardware / network interruption tests'],['Reporting','Summary, CSV and browser Save PDF','Combined logs and evidence export']],64,198,1150,360,[250,450,450],23);
text(s,'25 detector regression checks passed',64,600,1100,50,32,C.teal,true,1);

// 14
s=base('Remaining work before final evaluation',{notes:'20 seconds. Labelled device trials should include ordinary reading, head turns, multiple faces, visible/partial phones and quiet/noisy speech. Measure detection latency separately from HTTP response and socket/evidence arrival. Remaining scope issue is headphones or supervisor-approved scope alignment. Report content consolidation and automatic retention policy are still open. Repeated, longer load trials need environment details and raw logs.'});
topic(s,'VALIDATION','Measured real-device results','False positives and missed detections\nDetection-to-dashboard latency\nLonger, repeated load tests\nLighting and microphone variation',64,190,535,1);
topic(s,'SCOPE & READINESS','Clear remaining deliverables','Headphone detection or scope alignment\nCombined evidence report export\nRetention policy and expiry decisions\nFull HDMI and recovery rehearsal',670,190,535,2);

// 15
s=base('Live demonstration',{dark:true,background:true,notes:'15 seconds to hand off, then a separate 7–8 minute demo. 0–1 minute create/show exam and rules. 1–3 minutes candidate consent, hardware readiness and enrollment. 3–5 minutes trigger a visible phone/head turn and one safe environment event. 5–7 minutes examiner reviews evidence and sends warning; candidate submits answer. 7–8 minutes historical report or controlled offline recovery if rehearsed. Use a separate candidate laptop: HDMI can add a display and block self-check. Save open work before strict enforcement. A backup recording must be clearly identified as recorded.'});
text(s,'01  Exam setup',64,210,810,60,34,C.white,true,1);
text(s,'02  Candidate consent and self-check',64,295,900,60,34,C.white,true,2);
text(s,'03  Monitoring and evidence review',64,380,900,60,34,C.white,true,3);
text(s,'04  Warning, submission and summary',64,465,930,60,34,C.white,true,4);
text(s,'7–8 minutes  /  one rehearsed end-to-end examination',64,600,1060,50,25,'#C1D5DD');

// 16
s=base('Questions and technical detail',{dark:true,background:true,notes:'End the main sequence here. The remaining slides support technical questions. Explain pretrained model use and the project contribution candidly. Do not interpret alerts as proof of misconduct.'});
text(s,'IntegrityFlow',64,250,850,100,68,C.white,true);
text(s,'Local monitoring with evidence\nfor examiner decisions',64,380,840,140,38,'#D8F2EC');
text(s,'Technical appendix follows',64,594,700,45,24,'#C1D5DD');

// 17
s=base('Vision: calibration and phone confirmation',{notes:'Appendix. Head direction uses MediaPipe Tasks landmarks plus cv2.solvePnP with six points. Stable single-face neutral calibration uses 20 observations, with wraparound-safe smoothing. Lateral alerts require relative and absolute yaw support, with 13-degree threshold and 0.5-second lateral dwell. Multiple faces suspend head-direction estimation. Phone detector uses 640x640 letterboxing, COCO class 67, same-class spatial overlap. After a candidate phone prediction, inference runs next frame. Two >=0.60 confidence predictions confirm, weaker predictions require three. Misses and spatial jumps reset, repeat cooldown 2s. These are algorithm settings, not measured real-world latency or accuracy. '+src(['candidate-app/ai-module/ai_monitor.py','candidate-app/ai-module/config/thresholds.json'])});
topic(s,'HEAD DIRECTION','Calibrated temporal checks','MediaPipe Tasks facial landmarks\nOpenCV PnP head-pose estimate\nStable neutral pose and smoothing\nAbsolute-yaw guard against biased baseline',64,190,535,1);
topic(s,'PHONE / BOOK','Class and spatial continuity','YOLO26n through ONNX Runtime\n640 × 640 letterboxed input\nPhone: two strong matching detections\nWeak phone / book: three matching checks',670,190,535,2);

// 18
s=base('Voice: speech gating and reference comparison',{notes:'Appendix. 16 kHz mono, 30ms frames, VAD Mode 2, configured speech gating 1.5s, verification segments3s, minimum RMS.003. Reference enrollment8s plus separate4s confirmation, processed speech minima3s/2s. Resemblyzer embedding256 dimensions, cosine threshold.75, two valid mismatches, cooldown60s. Reject too-short/clipped audio. This detects speaker mismatch, not reliable speaker count or all whispers. No real-room labelled evaluation validates the cutoff yet. '+src(['candidate-app/ai-module/voice_monitor.py','candidate-app/ai-module/config/thresholds.json','candidate-app/ai-module/evaluate_voice.py'])});
const q1=node(s,'Microphone\n16 kHz mono',64,224,250,110,1),q2=node(s,'WebRTC VAD\nSpeech frames',364,224,250,110,2),q3=node(s,'Resemblyzer\n256-d embedding',664,224,250,110,3),q4=node(s,'Reference check\nCosine similarity',964,224,250,110,4);
connect(s,q1,q2,2);connect(s,q2,q3,3);connect(s,q3,q4,4);
text(s,'Two valid mismatches before an alert',64,415,1135,60,34,C.teal,true,5);
text(s,'Short or clipped audio does not accumulate mismatches.\nReal-room testing must establish false alerts and missed speakers.',64,505,1120,106,29,C.muted,false,5);

// 19
s=base('UML sequence: live event and examiner review',{notes:'Appendix. Simplified sequence. Durable queues acknowledge locally before upstream delivery. HTTP201 follows database commit. Deferred event and score updates target authorized teacher/admin recipients. Teacher review can confirm or dismiss. No queue guarantees notification delivery through a server crash. '+src(['candidate-app/ai-module/services/violation_delivery.py','candidate-app/electron/ipc/violationBuffer.js','server/src/routes/violations.js','server/src/sockets/violationSocket.js'])});
const xs=[64,364,664,964];['Python','Electron','Express / MongoDB','Examiner'].forEach((v,k)=>node(s,v,xs[k],180,250,65,1));
xs.forEach(x=>s.shapes.add({geometry:'line',name:'fixed',position:{left:x+125,top:250,width:0,height:380},fill:'none',line:{fill:C.line,width:1,style:'dashed'}}));
function message(label,from,to,y,g){s.shapes.add({geometry:from<to?'rightArrow':'leftArrow',name:`reveal-${g}`,position:{left:Math.min(xs[from],xs[to])+125,top:y+40,width:Math.abs(xs[to]-xs[from]),height:12},fill:C.teal,line:{fill:'none',width:0}});text(s,label,Math.min(xs[from],xs[to])+125,y,Math.abs(xs[to]-xs[from]),40,22,C.ink,false,g);}
message('Persist and deliver event',0,1,278,2);
message('Persist and POST event',1,2,353,3);
message('Commit, then HTTP 201',2,1,428,4);
message('Authorized live update',2,3,503,5);
message('Confirm / dismiss evidence',3,2,578,6);

// 20
s=base('Delayed evidence after exam completion',{notes:'Appendix. An event originally generated during a valid session can arrive after completion. Server validates event identity and original timestamp, stores receivedLate and deduplicates retries. It retains evidence and does not automatically inflate final risk. Explicit examiner confirmation allows score contribution; dismissal excludes it. New activity after the valid session window is rejected. Controlled regression coverage exists but cloud/network recovery still needs rehearsal. '+src(['server/src/routes/violations.js','server/check_late_evidence.js','candidate-app/electron/ipc/violationBuffer.js'])});
topic(s,'RECOVERY','Original event identity survives','Candidate records an event during exam\nConnectivity drops before upload\nDurable queues retry after reconnection\nServer retains valid delayed evidence',64,190,535,1);
topic(s,'EXAMINER CONTROL','Final score remains reviewable','Late evidence is visibly marked\nRetries do not create duplicate events\nReview confirms or dismisses the event\nInvalid post-session activity is rejected',670,190,535,2);

// 21
s=base('Reported benchmark details',{notes:'Appendix. All figures supplied in the user message, not independently rerun. 158 total requests with17 failures produces89.2405% success, displayed89.2%. After189/189. Average ratio4142.10/408.76=10.13; median3923.40/333.25=11.77. Throughput6.58vs9.45 reflects measured report windows that appear unequal. P958000ms is supplied as the client timeout ceiling, not an independently reconstructed percentile. Request totals combine setup, writes and reads in load_test.py. Raw logs were not supplied. '+src(['scripts/load_test.py'])});
table(s,[['METRIC','BEFORE','AFTER'],['HTTP request success','89.2%','100.0%'],['Requests / timeouts','158 / 17','189 / 0'],['Mean latency','4,142.10 ms','408.76 ms'],['Median latency','3,923.40 ms','333.25 ms'],['Reported P95','8,000 ms (timeout ceiling)','856.43 ms'],['Reported throughput','6.58 requests/s','9.45 requests/s']],64,185,1150,390,[485,333,332],24);
text(s,'After command: 50 candidates, 20 seconds, dashboard reads enabled',64,595,1130,42,24,C.teal,true);
text(s,'Raw logs and test environment were not supplied. Repeat longer matched runs before claiming capacity.',64,642,1130,40,18,C.muted);

// 22
s=base('Access boundaries, consent and evaluation limits',{notes:'Appendix. Teacher sockets are scoped to owned exams, admin rights are broader. Voice consent discloses stored speaker reference vectors and audio clips, including local/uploaded evidence. Current removal is manual, with no automatic expiry. Local inference does not mean every part of the system works without central connectivity. Regression tests establish selected behavior, not production security or statistical accuracy. '+src(['server/src/sockets/violationSocket.js','server/src/utils/examAccess.js','candidate-app/renderer/identity.js','candidate-app/electron/check_consent.js'])});
topic(s,'ACCESS & PRIVACY','Explicit boundaries','Teacher events scoped to owned exams\nAdministrators have broader access\nConsent covers voice profiles and clips\nRetention currently requires manual removal',64,190,535,1);
topic(s,'EVALUATION','Evidence behind each claim','Pretrained models, integrated locally\nControlled regression checks completed\nHTTP benchmark supplied by the team\nAccuracy and long-run capacity still open',670,190,535,2);

await fs.writeFile(path.join(dir,'deck-content.json'),JSON.stringify({slides:22,mainSlides:15,font:family,benchmarkSource:'User-supplied narrative, 3 October 2026. No raw logs supplied.',animation:'Click-controlled reveal groups and fade transitions'},null,2));
await (await PresentationFile.exportPptx(p)).save(path.join(dir,'draft.pptx'));
for(let k=0;k<p.slides.items.length;k++){
 const slide=p.slides.items[k];
 const blob=await p.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(dir,'previews',`slide-${String(k+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
 console.log('RENDERED',k+1);
}
console.log('EXPORTED',path.join(dir,'draft.pptx'));
