const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'../extension');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://diffnote.test/**',async route=>{
   const file=new URL(route.request().url()).pathname.slice(1)||'index.html';let body=fs.readFileSync(path.join(root,file));
   if(file==='app.js')body=Buffer.from(body.toString()+'\nwindow.testApi={inputEditors,editors:()=>resultEditors};');
   await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':JSON.parse(fs.readFileSync(root+'/manifest.json')).content_security_policy.extension_pages}});
  });
  await page.goto('http://diffnote.test/index.html');await page.waitForSelector('.cm-editor');
  await page.selectOption('#language','plaintext');
  const makeLines=n=>Array.from({length:n},(_,i)=>'line '+i+' sample').join('\n');
  await page.evaluate(([left,right])=>{testApi.inputEditors.left.setValue(left);testApi.inputEditors.right.setValue(right)},[makeLines(160),makeLines(310)]);
  await page.click('#compare');
  const atProgress=async(index,ratio)=>{
   await page.evaluate(([i,r])=>{const el=testApi.editors()[i].view.scrollDOM;el.dispatchEvent(new Event('pointerdown'));el.scrollTop=r*(el.scrollHeight-el.clientHeight)},[index,ratio]);
   try{await page.waitForFunction(([i,r])=>{const views=testApi.editors().map(e=>e.view.scrollDOM),a=views[i].scrollTop/(views[i].scrollHeight-views[i].clientHeight);return views.every(s=>Math.abs(s.scrollTop/(s.scrollHeight-s.clientHeight)-a)<.005)&&(r===0?a<.005:r===1?a>.995:a>.05&&a<.95)},[index,ratio]);}catch(error){console.log('scroll debug',index,ratio,await page.evaluate(()=>testApi.editors().map(e=>{const s=e.view.scrollDOM;return {top:s.scrollTop,height:s.scrollHeight,client:s.clientHeight,ratio:s.scrollTop/(s.scrollHeight-s.clientHeight)}})));throw error;}
  };
  console.log('testing scroll');await atProgress(0,.4);await atProgress(1,.7);await atProgress(0,1);await atProgress(1,0);
  // A real wheel gesture on either side drives the other side.
  console.log('testing wheel');for(const i of [0,1]){
   await page.locator('.result-code .cm-scroller').nth(i).hover();await page.mouse.wheel(0,300);
   await page.waitForFunction(()=>{const [a,b]=testApi.editors().map(e=>e.view.scrollDOM);return a.scrollTop>0&&b.scrollTop>0&&Math.abs(a.scrollTop/(a.scrollHeight-a.clientHeight)-b.scrollTop/(b.scrollHeight-b.clientHeight))<.015});
  }
  // No scroll feedback drift after several animation frames.
  await page.waitForFunction(()=>{const now=performance.now(),values=testApi.editors().map(e=>e.view.scrollDOM.scrollTop);const last=window.scrollSample;if(!last||values.some((v,i)=>Math.abs(v-last.values[i])>1)){window.scrollSample={values,time:now};return false}return now-last.time>180});
  // Native browser resize handles, in both directions, must move both inputs.
  console.log('testing native resize');for(const side of ['left','right']){
   const box=await page.locator('#'+side+'Editor .cm-editor').boundingBox();
   await page.mouse.move(box.x+box.width-3,box.y+box.height-3);await page.mouse.down();await page.mouse.move(box.x+box.width-3,box.y+box.height+70,{steps:8});await page.mouse.up();
   await page.waitForFunction(before=>{const h=Object.values(testApi.inputEditors).map(e=>e.view.dom.getBoundingClientRect().height);return h[0]>before+25&&Math.abs(h[0]-h[1])<1},box.height);
  }
  console.log('testing lifecycle');const intact=await page.evaluate(()=>Object.values(testApi.inputEditors).map(e=>e.getValue()));
  assert.deepEqual(intact,[makeLines(160),makeLines(310)]);
  // A queued scroll synchronization is cancelled when results are replaced.
  await page.evaluate(()=>{const old=testApi.editors()[0].view.scrollDOM;old.scrollTop=100;old.dispatchEvent(new Event('scroll'));document.querySelector('#compare').click()});
  await atProgress(1,.5);
  await page.click('#clear');await page.click('#example');
  assert.equal(await page.locator('.result-code .cm-editor').count(),2);
  // Different folding states and non-scrollable panes do not pull the long pane back.
  console.log('testing folds');await page.selectOption('#language','json');
  await page.evaluate(()=>{const rows=Array.from({length:150},(_,i)=>({id:i}));const text=JSON.stringify({rows},null,2);for(const e of Object.values(testApi.inputEditors))e.setValue(text)});
  await page.click('#compare');
  await page.getByRole('button',{name:'原始文本结果：折叠当前',exact:true}).click();
  await page.evaluate(()=>{const e=testApi.editors()[1].view.scrollDOM;e.dispatchEvent(new Event('pointerdown'));e.scrollTop=(e.scrollHeight-e.clientHeight)*.6});
  await page.waitForFunction(()=>{const [a,b]=testApi.editors().map(e=>e.view.scrollDOM);return a.scrollTop===0&&Math.abs(b.scrollTop/(b.scrollHeight-b.clientHeight)-.6)<.015});
  await page.setViewportSize({width:600,height:950});
  await page.evaluate(()=>{testApi.inputEditors.right.view.dom.style.height='180px'});
  await page.waitForFunction(()=>Object.values(testApi.inputEditors).every(e=>Math.abs(e.view.dom.getBoundingClientRect().height-180)<1));
  assert.deepEqual(errors,[]);
  console.log('PASS: bidirectional proportional result scrolling, wheel gestures, no feedback drift, native resize handles on both inputs, text preservation, result replacement/clear, asymmetric folding and narrow viewport.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
