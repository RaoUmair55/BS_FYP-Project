const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Rao Umair/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
 const page=await browser.newPage({viewport:{width:1366,height:900}});
 const exams=['A','B'].map(id=>({_id:'exam-'+id,examCode:'EXAM-'+id,title:'Mock '+id,status:'active',examType:'online',paperPath:'/uploads/papers/test.pdf',paperReleased:false,durationMinutes:60,allowedApplications:[],rules:{}}));
 const sessions=['A','B'].map(id=>({_id:'session-'+id,studentId:'student-'+id,studentName:'Candidate '+id,rollNumber:'12345',examId:'EXAM-'+id,status:'active',riskScore:0,cameraVerificationPhoto:'/logo.svg',cameraVerificationStatus:'pending',cameraPhotos:[{url:'/logo.svg',source:'initial',capturedAt:new Date().toISOString(),status:'pending'}],cameraPhotoRequests:[]}));
 const calls=[];
 await page.route('http://localhost:5000/**',route=>{
  const url=route.request().url();const method=route.request().method();let data=[];
  if(url.includes('socket.io'))return route.abort();
  if(url.includes('/auth/refresh'))data={accessToken:'mock-ui-token'};
  else if(url.includes('/auth/me'))data={teacher:{id:'teacher-preview',name:'Examiner Preview',role:'teacher',emailVerified:true}};
  else if(url.includes('/sessions/active'))data=sessions;
  else if(url.includes('/extend-time')){calls.push(url);data={success:true};}
  else if(url.includes('/request-camera-photo')){sessions[0].cameraPhotoRequests=[{id:'request',source:'requested',completedAt:null}];data={session:sessions[0]};}
  else if(url.includes('/camera-verification')&&method==='PATCH'){sessions[0].cameraVerificationStatus='verified';sessions[0].cameraPhotos[0].status='verified';data={session:sessions[0]};}
  else if(url.includes('/exams'))data=exams;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:4178');await page.getByRole('button',{name:'Exams',exact:true}).click();
 await page.locator('.exam-card').filter({hasText:'Mock A'}).getByRole('button',{name:/Live Monitor/}).click();
 await page.getByRole('button',{name:'Webcam Grid',exact:true}).click();
 const grid=page.locator('.candidate-grid-card');await grid.getByText('Candidate A',{exact:true}).first().waitFor();
 assert.equal(await grid.getByText('Candidate B',{exact:true}).count(),0);
 assert.equal(await grid.getByRole('button',{name:/Release/}).count(),1);
 await grid.getByRole('button',{name:'+5m for everyone',exact:true}).click();assert(calls[0].includes('EXAM-A/extend-time'));
 await grid.getByRole('button',{name:'Confirm Identity',exact:true}).click();await grid.getByText('Identity Confirmed',{exact:true}).waitFor();assert.equal(await grid.locator('img').count(),2);
 await grid.locator('summary').click();await grid.getByText(/initial · Verified/).waitFor();
 page.once('dialog',dialog=>dialog.accept('Improve lighting'));await grid.getByRole('button',{name:'Request new photo',exact:true}).click();await grid.getByRole('button',{name:'Photo requested',exact:true}).waitFor();
 await page.screenshot({path:'tmp/camera-grid-1366.png',fullPage:true});
 await page.setViewportSize({width:768,height:900});await page.screenshot({path:'tmp/camera-grid-768.png',fullPage:true});
 console.log('PASS: selected-exam grid, one release control, exam-wide extension target, retained verified photo/history and photo request. Mock data only; no real exams changed.');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1});
