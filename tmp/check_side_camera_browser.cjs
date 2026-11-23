const assert=require('node:assert/strict'),path=require('node:path');
const express=require('../server/node_modules/express');
const {chromium}=require('C:/Users/Rao Umair/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const app=express();app.use('/side-camera',require('../server/src/routes/sideCameraPage'));app.use('/candidate',express.static(path.resolve('candidate-app/renderer')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const failures=[];
  page.on('pageerror',e=>failures.push(e.message));
  await page.goto(base+'/side-camera/?token=test');await page.screenshot({path:'tmp/side-camera-phone-390.png',fullPage:true});
  assert.equal(await page.locator('#start').count(),1);assert.equal(await page.locator('#monitor').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Load the real vendored WASM and model in a desktop browser to check compatibility and same-origin delivery.
  const model=await page.evaluate(async()=>{
   const {ObjectDetector,FilesetResolver}=await import('/side-camera/vendor/vision_bundle.mjs');
   const files=await FilesetResolver.forVisionTasks('/side-camera/vendor/wasm');
   const detector=await ObjectDetector.createFromOptions(files,{baseOptions:{modelAssetPath:'/side-camera/models/efficientdet_lite0.tflite'},runningMode:'IMAGE',scoreThreshold:.5});
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   canvas.getContext('2d').fillRect(0,0,640,480);const count=detector.detect(canvas).detections.length;detector.close();return count;
  });assert.equal(model,0);
  assert.deepEqual(failures,[]);
  const qr=await require('../server/node_modules/qrcode').toDataURL('https://backend.example.test/side-camera/?token=example');
  await page.addInitScript(()=>{
   window.__handlers={};window.__sideSocketCalls=0;
   window.io=()=>{window.__sideSocketCalls++;return {on:(name,fn)=>{window.__handlers[name]=fn;},disconnect(){}};};
   window.api={getSessionInfo:async()=>({sessionId:'session-a',sessionToken:'mock-token',serverUrl:'https://backend.example.test',studentName:'Candidate Preview',examType:'physical_lab',requireSecondaryCamera:true})};
  });
  await page.route('https://backend.example.test/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'},body:JSON.stringify({qrImage:qr})}));
  await page.setViewportSize({width:768,height:900});await page.goto(base+'/candidate/selfCheck.html');await page.locator('#side-camera-qr').waitFor({state:'visible'});
  await page.evaluate(()=>{appsPassed=usbPassed=displayPassed=true;updateBeginButton();});assert.equal(await page.locator('#btn-begin-exam').isDisabled(),true);
  await page.evaluate(()=>{
   window.__handlers['side-camera-status']({status:'connected',placementVerified:false});
   window.__handlers['placement-result']({sessionId:'session-a',criteria:{person:true,workstation:false,lighting:true,steady:false},verified:false});
   window.__handlers['preview-frame']({sessionId:'session-a',frame:'data:image/jpeg;base64,/9j/2Q=='});
  });assert.equal(await page.locator('#side-camera-preview').isVisible(),true);
  await page.screenshot({path:'tmp/side-camera-setup-768.png',fullPage:true});
  await page.evaluate(()=>window.__handlers['side-camera-status']({status:'verified',placementVerified:true}));
  assert.equal(await page.locator('#side-camera-preview').isVisible(),false);assert.equal(await page.locator('#btn-begin-exam').isDisabled(),false);
  await page.evaluate(()=>window.__handlers['side-camera-status']({status:'lost',placementVerified:false}));assert.equal(await page.locator('#btn-begin-exam').isDisabled(),true);
  await page.evaluate(async()=>{
   const marker=document.createElement('span');marker.id='monitoringBadge';document.body.append(marker);
   await window.IntegritySideCamera.monitor({sessionId:'session-a',sessionToken:'mock-token',serverUrl:'https://backend.example.test',requireSecondaryCamera:true});
   window.__handlers['side-camera-status']({status:'lost',placementVerified:false});
  });
  await page.locator('#side-camera-repair summary').click();
  await page.locator('#side-camera-repair button').click();
  assert.equal(await page.locator('#side-camera-repair img').isVisible(),true);
  await page.evaluate(()=>window.__handlers['side-camera-status']({status:'verified',placementVerified:true}));
  assert.equal(await page.locator('#side-camera-repair').isVisible(),false);
  await page.addInitScript(()=>{window.api.getSessionInfo=async()=>({sessionId:'session-a',studentName:'Normal Exam',examType:'physical_lab',requireSecondaryCamera:false});});
  await page.reload();await page.waitForTimeout(100);assert.equal(await page.locator('#check-side-camera').isVisible(),false);assert.equal(await page.evaluate(()=>window.__sideSocketCalls),0);
  console.log('PASS: real local WASM/model loads with route CSP; phone mobile layout; candidate setup criteria/preview, verified/lost Begin gate and disabled-feature no-socket behavior. Browser checks use simulated session and phone state, not a real phone.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
