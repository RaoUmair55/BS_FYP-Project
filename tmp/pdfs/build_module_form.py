from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from pypdf import PdfReader

OUT = Path('output/pdf/IntegrityFlow_Module_Form.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 595.28, 841.89
LEFT, RIGHT, COL = 42, 553.28, 212
c = canvas.Canvas(str(OUT), pagesize=(W,H))
c.setTitle('IntegrityFlow - Module Document')
c.setAuthor('IntegrityFlow Project Team')
regular = ParagraphStyle('regular', fontName='Times-Roman', fontSize=11, leading=14)
bold = ParagraphStyle('bold', parent=regular, fontName='Times-Bold')
center = ParagraphStyle('center', parent=bold, alignment=TA_CENTER)

def para(text,x,top,width,style=regular):
    p=Paragraph(text,style)
    _,height=p.wrap(width,700)
    p.drawOn(c,x,top-height)
    return height

def row(left,right,top,height,leftbold=True):
    c.setStrokeColor(colors.black)
    c.setLineWidth(.65)
    c.rect(LEFT,top-height,RIGHT-LEFT,height)
    c.line(COL,top,COL,top-height)
    para(left,LEFT+7,top-7,COL-LEFT-14,bold if leftbold else regular)
    para(right,COL+8,top-7,RIGHT-COL-16)
    return top-height

def heading(top,text):
    c.rect(LEFT,top-25,RIGHT-LEFT,25)
    para(text,LEFT+7,top-6,RIGHT-LEFT-14,center)
    return top-25

def modules(top, items):
    top=row("Module's Name",'Module Description with Deliverables',top,27)
    for name, bullets in items:
        content='<br/>'.join('- '+x for x in bullets)
        a=Paragraph(name,bold); b=Paragraph(content,regular)
        height=max(a.wrap(COL-LEFT-14,700)[1],b.wrap(RIGHT-COL-16,700)[1])+17
        assert top-height > 65, (name,top,height)
        top=row(name,content,top,height)
    return top

def footer(page):
    c.setFont('Times-Roman',9)
    c.drawString(LEFT,28,'IntegrityFlow | Module Document')
    c.drawRightString(RIGHT,28,f'Page {page} of 3')

def field(name,x,top,width,value=''):
    c.acroForm.textfield(name=name, tooltip=name.replace('_',' '), x=x,y=top-23,
        width=width,height=18,value=value,fontName='Times-Roman',fontSize=11,
        borderWidth=0,fillColor=colors.white,textColor=colors.black,forceBorder=False)

top=794
top=row('Project Title','<b>IntegrityFlow</b><br/>An Autonomous AI Examination Monitoring and Secure Environment System',top,49)
top=row('Supervisor Name','Mr. Abdullah',top,29)
previous=top
top=row('Co-Supervisor Name','',top,29)
field('co_supervisor',COL+8,previous,RIGHT-COL-16)
top=heading(top,'Group information')
top=row('Roll number',"Student's Name",top,27)
for name,key in [('Rao Umair Ahmed','umair_roll_number'),('Muhammad Usman','usman_roll_number'),('Muhammad Abubakar Siddique','abubakar_roll_number')]:
    previous=top
    top=row('',name,top,29)
    field(key,LEFT+7,previous,COL-LEFT-14,{'umair_roll_number':'233163','usman_roll_number':'233161','abubakar_roll_number':'232493'}[key])
top-=16
modules(top,[
('1. Secure Environment Enforcement',[
'Windows candidate desktop application using Electron.',
'Application whitelist enforcement with examiner-permitted tools and process monitoring.',
'Clipboard and display restrictions, USB-storage monitoring and pre-existing-file checks.',
'Explicit permitted-file exceptions and online/physical-lab exam modes.']),
('2. AI Monitoring',[
'Local webcam processing using OpenCV and MediaPipe face landmarks when available.',
'Head-turn, missing-face, multiple-face/person and camera-obstruction signals.',
'YOLO26n ONNX inference for configured phone/book checks.',
'Calibration and confidence/persistence filters; alerts support examiner review.']),
('3. Evidence Capture &amp; Delivery',[
'Event-triggered desktop screenshots for system events and webcam frames for visual events.',
'Timestamped JPEG evidence linked to the candidate session and violation.',
'Local durable queues, stable event IDs and retries through Python and Electron.',
'Server evidence storage and retrieval, including valid delayed evidence after exam completion.'])])
footer(1); c.showPage()

para('IntegrityFlow - System Modules',LEFT,796,RIGHT-LEFT,bold)
modules(770,[
('4. Candidate Self-Check System',[
'Step-by-step camera/face calibration, microphone and reference-voice checks.',
'Application, USB-storage and display verification before exam entry.',
'Physical-lab mode bypasses camera and voice checks.']),
('5. Violation Severity Scoring Engine',[
'Server-side severity weighting and time-decayed aggregation of violation records.',
'Per-candidate risk score and examiner review priority.',
'Review decisions affect scoring; risk is not a probability of cheating.']),
('6. Examiner Dashboard &amp; Exam Management',[
'Create/manage exams, release papers and configure rules and permitted applications.',
'Live Monitoring, Active Candidates, Priority Queue and exam-scoped evidence review.',
'Socket.IO updates restricted by examiner ownership/admin access.',
'Confirm/dismiss alerts, review submissions and inspect historical exams.']),
('7. Answer Submission System',[
'Candidate paper viewing, typed answers and supported file uploads.',
'Local text drafts, exam timing and submission controls.',
'Answers linked to the candidate session; examiner retrieval and download.']),
('8. Audit Report / Exam Summary',[
'Historical exam summaries, final risk scores and violation/risk distributions.',
'CSV export and browser print/Save PDF.',
'Detailed alert logs and screenshots remain in the separate evidence viewer; an all-evidence export is remaining work.'])])
footer(2); c.showPage()

para('IntegrityFlow - Additional Implemented Modules',LEFT,796,RIGHT-LEFT,bold)
top=modules(770,[
('9. Voice Monitoring &amp; Speaker Comparison',[
'WebRTC VAD selects speech; Resemblyzer generates speaker-reference vectors.',
'Cosine-similarity comparison and repeated valid mismatches flag possible other-speaker activity.',
'Suspicious audio clips support review; consent discloses voice/evidence collection.',
'Offline labelled-recording evaluation supports testing; no speaker-count or accuracy guarantee.']),
('10. Authentication &amp; Administration',[
'Teacher/admin authentication, account verification/reset and role/ownership checks.',
'Administrative user/asset management and activity audit records.',
'Teacher information and consistent light/dark dashboard themes.']),
('11. Examiner-Candidate Communication',[
'Exam chat, broadcasts and examiner warnings.',
'Session termination and time-extension controls.',
'Candidate status updates and re-verification requests during the exam.'])])
top-=20
top-=para('Respected Evaluator, if you recommend an improvement or suggest a new module, please mention it in this section.',LEFT,top,RIGHT-LEFT)
top-=14
para("Evaluator's Name:",LEFT,top,140,bold)
field('evaluator_name',160,top+4,RIGHT-160)
top-=34
para('Suggestions',LEFT,top,RIGHT-LEFT,bold)
top-=24
c.acroForm.textfield(name='evaluator_suggestions',tooltip='Evaluator suggestions',x=LEFT,y=top-90,
    width=RIGHT-LEFT,height=90,fontName='Times-Roman',fontSize=11,borderWidth=.65,
    fillColor=colors.white,textColor=colors.black,fieldFlags='multiline')
top-=135
c.line(LEFT,top,LEFT+200,top); c.line(RIGHT-215,top,RIGHT,top)
para('Supervisor Signature',LEFT,top-8,200)
para('Signature FYP Committee Member',RIGHT-215,top-8,215)
footer(3); c.save()
reader=PdfReader(OUT)
assert len(reader.pages)==3
fields=reader.get_fields()
assert set(fields)=={'co_supervisor','umair_roll_number','usman_roll_number','abubakar_roll_number','evaluator_name','evaluator_suggestions'}
assert fields['umair_roll_number']['/V']=='233163'
assert fields['usman_roll_number']['/V']=='233161'
assert fields['abubakar_roll_number']['/V']=='232493'
for page in reader.pages:
    for ref in page.get('/Annots',[]):
        widget=ref.get_object()
        assert widget.get('/AP',{}).get('/N') is not None
print(f'Created {OUT}; 3 pages; six editable blank fields verified.')

