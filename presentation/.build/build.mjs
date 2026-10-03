import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const root = 'D:/BS_FYP Project/IntegrityFlow';
const workspaceDir = `${root}/presentation`;
const skill = 'C:/Users/Rao Umair/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const python = 'C:/Users/Rao Umair/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const { finalizePresentation } = await import(pathToFileURL(`${skill}/container_tools/artifact_tool_utils.mjs`).href);
const p = Presentation.create({slideSize:{width:1280,height:720}});
const source = 'Scope: IntegrityFlow_Scope_v3_Enhanced.pdf, 8 May 2026. Code review: 3 October 2026.';

function text(slide, value, x,y,w,h,size=30,color='#213A46',bold=false) {
  const box=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  box.text=value;
  box.text.style={typeface:'Arial',fontSize:size,color,bold,autoFit:'none'};
  return box;
}
function slide(title, notes, dark=false) {
  const s=p.slides.add(); s.background.fill=dark?'#153B45':'#FAFCFB';
  text(s,title,72,52,1120,82,44,dark?'#FFFFFF':'#075E59',true);
  text(s,`${String(p.slides.items.length).padStart(2,'0')}  IntegrityFlow`,72,660,1050,28,18,dark?'#A8D9CF':'#637C80');
  s.speakerNotes.textFrame.setText(`${notes}\n\n${source}`);
  return s;
}
function lines(s, rows, dark=false, start=176) {
  rows.forEach((r,i)=>text(s,r,76,start+i*86,1120,76,32,dark?'#FFFFFF':'#213A46'));
}
function pairs(s, entries, dark=false) {
  entries.forEach((e,i)=>{
    const col=i%2,row=Math.floor(i/2),x=76+col*585,y=176+row*148;
    text(s,e[0],x,y,535,43,30,dark?'#9AE1CC':'#087D78',true);
    text(s,e[1],x,y+49,500,entries.length <= 4 ? (row === 0 ? 96 : 125) : 86,25,dark?'#EEF6F4':'#213A46');
  });
}

let s=slide('IntegrityFlow','Opening: 15 seconds. Introduce the team and supervisor. Names are from scope p. 1. Confirm current roles with the team. Presentation date follows the teacher message: Monday 5 October 2026 at 4 PM.');
text(s,'FYP Progress Presentation',76,167,810,72,42,'#213A46',true);
text(s,'Local AI examination monitoring\nand a controlled exam environment',76,267,805,120,35);
text(s,'Rao Umair Ahmed\nMuhammad Usman\nMuhammad Abubakar Siddique',76,440,805,112,26);
text(s,'Supervisor: Mr. Abdullah     5 October 2026',76,585,1040,44,25,'#637C80');
s.images.add({blob:new Uint8Array(await fs.readFile(`${root}/dashboard/public/logo512.png`)),contentType:'image/png',alt:'IntegrityFlow project logo',fit:'contain',position:{left:940,top:208,width:245,height:245}});

s=slide('Problem and objectives','30 seconds. Remote candidates may use unauthorized software, physical aids or help from another person. The project creates a semi-controlled environment, analyzes signals locally, records event evidence and helps the examiner review. Avoid unverified claims about competitors or guaranteed prevention. Scope pp. 2, 4-6.');
lines(s,['Unauthorized tools and physical aids challenge exam integrity.','Local analysis reduces dependence on continuous video upload.','Application controls restrict the allowed exam environment.','Evidence and risk scores help examiners prioritize review.']);

s=slide('Project scope','45 seconds. Windows desktop, local vision and process enforcement, event-based evidence, examiner alerts and session-linked submissions are in scope. Voice is an added feature outside v3 scope. Facial identity recognition, macOS/Linux, network scanning and IoT remain outside. Scope p. 6. Discuss the exact scope update in backup slide 11 if asked.');
pairs(s,[['Candidate application','Windows Electron shell, exam paper and answer submission'],['Local monitoring','Head turns, multiple faces and phone/book detection'],['Examiner workflow','Live alerts and evidence review\nStudent risk ratings'],['Boundaries','Best-effort assistance with human review\nAdvanced face recognition and other OSes remain outside']]);

s=slide('System architecture','40 seconds. Candidate camera/audio/process inputs are analyzed locally in Python. Local loopback HTTP connects Electron and Python using dynamically assigned ports. Electron sends events and evidence to Express/MongoDB with optional local or Cloudinary storage. Authenticated Socket.IO delivers updates to React. Do not claim full tenant isolation: socket recipient condition still needs tightening. Sources: candidate-app/ai-module/main.py, electron/ipc/pythonBridge.js, server/src/index.js, services/storage/index.js, dashboard/src/hooks/useSocket.js.',true);
pairs(s,[['Candidate device','Electron workspace with Python monitoring\nMediaPipe when available, OpenCV fallback and ONNX'],['Local bridge','Available loopback ports\nHealth checks and an Electron offline queue'],['Backend','Express API and MongoDB\nEvidence storage and severity scoring'],['Examiner dashboard','React with Socket.IO updates\nEvidence review and session management']],true);

s=slide('Major modules and implementation','45 seconds. Five core modules exist in code. Secure environment, evidence, dashboard and submission substantially match the functional scope. AI is partial against exact specifications because model family/classes/fallback differ. Both optional modules have implementation paths. Advanced reporting has summary/CSV/browser printing. This is implementation coverage, not an acceptance percentage. Scope pp. 8-10 and Scope_Progress_Verification.md.');
pairs(s,[['Core: environment and evidence','Allowlist checks and triggered evidence capture'],['Core: candidate submissions','Paper viewer, typed drafts and uploaded answers'],['Core: examiner dashboard','Candidates, alert feed and evidence decisions'],['Core: AI monitoring','Implemented with model/class scope gaps'],['Optional: self-check and scoring','Both have integrated implementation paths'],['Advanced: reporting','Summary and CSV available\nAutomatic full PDF report remains partial']]);

s=slide('Current validation evidence','45 seconds. Explain the difference between deterministic tests and real-world accuracy. During this preparation actual local online and lab self-check startups passed, as did queue persistence/retry and 13 Python regression checks. They use controlled inputs and a fake HTTP backend. They do not establish strict enforcement, real microphone accuracy, capacity or dashboard latency. Source: candidate-app/electron/check_reliability.js, ai-module/check_detection.py and current tool results.');
text(s,'13 regression checks passed',76,176,1120,82,48,'#087D78',true);
text(s,'Both local startup modes and offline retry checks passed.',76,291,1120,88,32);
text(s,'Controlled checks cover detector continuity, calibration,\nevidence duration and failure reporting.',76,389,1120,100,30);
text(s,'Live accuracy, capacity and performance targets remain to measure.',76,542,1120,68,28,'#7C4B20',true);

s=slide('Additions beyond scope v3','35 seconds. List additions as implemented code paths, not all independently acceptance-tested. Voice was explicitly future work in scope p. 6. It now has enrollment/confirmation and saved suspicious clips; it is a mismatch signal for review. The scope and consent must acknowledge stored speaker embeddings. Sources: voice_monitor.py, usb_monitor.py, selfCheck.js, ExamManager.jsx, ExamSummary.jsx, AdminDashboard/, Dashboard.jsx, messages.js.');
pairs(s,[['Physical-lab support','Environment checks with camera/voice bypass'],['Speaker verification','Reference enrollment and suspicious audio evidence'],['Exam controls','Chat, warnings, time extensions and lifecycle management'],['Examiner organization','Priority queue, history and dark mode'],['Environment safeguards','USB/display checks and pre-existing-file guards'],['Administration and recovery','Asset/user management, audit logs and offline buffering']]);

s=slide('Remaining work','40 seconds. Make four concrete points. First, controlled head-turn/multiple-face/object/voice evaluation and false-positive measurement. Second, remaining headphones/model/quantization specifications and scope alignment. Third, socket ownership, voice consent/retention and late-evidence handling. Fourth, 20-client load, less than 2-second trigger-to-dashboard target and less than 35% average CPU over 30 minutes. None is an achieved result. Scope pp. 14-15; ai_monitor.py; violations.js; violationSocket.js:54; consent.html.',true);
lines(s,['Scenario accuracy and false-positive measurement','Model/class alignment and the missing headphone detector','Examiner isolation, voice consent and delayed evidence handling','20-client load, alert latency and 30-minute resource tests'],true);

s=slide('Live demonstration','50 seconds. Demo 7-8 minutes. Prepare an exam before the talk, then show candidate entry/consent/self-check, paper and typed answer, one rehearsed head turn and phone observation, examiner review/score, message, submission and history. Rehearse HDMI/display policy. Keep strict app termination, voice/offline/admin as Q&A options unless fully rehearsed. Demo_and_Speaking_Plan.md contains timing and fallback steps.');
lines(s,['Exam setup and candidate self-check','Local detection with event evidence on the examiner dashboard','Human review, risk score and candidate communication','Submission, historical summary and report options']);

s=slide('Questions and answers','Reserve 3-7 minutes. Explain contribution as integration and local event-based monitoring using pretrained models. Do not describe a risk score as cheating probability. Acknowledge that AI accuracy and capacity targets still need formal evaluation. Use slides 11-12 only if asked. Scope pp. 2, 5 and 15.',true);
text(s,'Examiner judgment remains central',76,218,1120,106,52,'#FFFFFF',true);
text(s,'Implemented workflow\nScope changes and limitations\nValidation and remaining work',76,373,1120,172,32,'#A8D9CF');

s=slide('Backup: scope and code differences','Backup detail only. Code prefers yolo26n.onnx over INT8. Targets phone/book, not headphones. Current installed MediaPipe lacks legacy solutions so OpenCV is active. Voice speaker embeddings conflict with scope no-biometric statement and consent lacks explicit audio-storage disclosure. This slide is for transparent discussion, not an assertion that all scope changes have supervisor approval. Scope pp. 6, 9-12; ai_monitor.py:138-140 and targets; voice_monitor.py storage; consent.html.');
pairs(s,[['Model and classes','YOLO26n with phone/book targets\nYOLOv8n INT8 and headphones differ from scope'],['Head-turn implementation','OpenCV fallback on this environment\nMediaPipe PnP code remains available'],['Evidence and privacy','Annotated stills, reference photo and audio clips\nVoice profiles require scope/consent alignment'],['Reporting and scoring','CSV and browser print rather than automatic PDF\n30-minute decay with a persistent baseline']]);

s=slide('Evaluation targets','Backup detail. All values are scope targets rather than achieved measurements. Scope pp. 14-15. Head-pose scenarios refer to the original greater-than-30-degree evaluation condition, despite changed runtime threshold. Scope p. 7 discusses 50 students, whereas acceptance p. 15 requires a 20-client test. Do not treat either as a passed benchmark.');
pairs(s,[['Vision scenarios','Head turns: 80%+\nMultiple-person: 85%+\nPhone detection: 75%+'],['Application enforcement','Ten unauthorized-app attempts\nTarget: all blocked'],['Alert delivery','Within 2 seconds after trigger\nMeasure through visible dashboard update'],['Capacity and resources','CPU average below 35% over 30 minutes\nTwenty simulated clients without failure']]);

await fs.mkdir(`${workspaceDir}/.build`,{recursive:true});
await fs.mkdir(`${workspaceDir}/output`,{recursive:true});
const candidatePath=`${workspaceDir}/.build/draft.pptx`;
await (await PresentationFile.exportPptx(p)).save(candidatePath);
for (let i=0;i<p.slides.items.length;i++) {
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(`${workspaceDir}/.build/slide-${i+1}.png`,new Uint8Array(await blob.arrayBuffer()));
}
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath:`${workspaceDir}/output/IntegrityFlow_Progress_Presentation_Ready.pptx`,pythonExecutable:python,integrityValidatorPath:`${skill}/container_tools/inspect_presentation_package_integrity.py`,layoutValidatorPath:`${skill}/container_tools/inspect_presentation_layout_geometry.py`,layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:12,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:`${workspaceDir}/.build/validation-ready.json`});
console.log(JSON.stringify(result));
