const {chromium}=require('playwright-core');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'../extension'),sandbox={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(root+'/diff.js','utf8'),sandbox);const compare=sandbox.module.exports.compareText;
for(const [left,right,count] of [['one\nkeep\nold','two\nkeep\nnew',2],['apple pear','banana orange',1],['old\nold','new\nnew',1],['same','same',0],['','new',1],['gone','',1],['🙂\nold\nsame\n旧','🙂\nnew\nsame\n新',2]]){
 const data=compare(left,right);assert.equal(data.differences.length,count);
 for(const stop of data.differences)for(const [side,text] of [['left',left],['right',right]])assert(stop[side].from>=0&&stop[side].to<=text.length&&stop[side].from<=stop[side].to);
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://diffnote.test/**',async route=>{const file=new URL(route.request().url()).pathname.slice(1)||'index.html';let body=fs.readFileSync(path.join(root,file));if(file==='app.js')body=Buffer.from(body.toString()+'\nwindow.testApi={inputEditors,editors:()=>resultEditors,navigation:()=>({locations:differenceLocations,index:differenceIndex})};');await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':JSON.parse(fs.readFileSync(root+'/manifest.json')).content_security_policy.extension_pages}})});
  await page.goto('http://diffnote.test/index.html');await page.waitForSelector('.cm-editor');
  assert(await page.locator('#nextDifference').isDisabled());
  const old=Array.from({length:18},(_,i)=>({id:i,name:'old'}));const updated=structuredClone(old);for(const i of [0,8,17])updated[i].name='new';updated[0].extra='added';
  await page.evaluate(([left,right])=>{testApi.inputEditors.left.setValue(left);testApi.inputEditors.right.setValue(right)},[JSON.stringify(old,null,2),JSON.stringify(updated,null,2)]);await page.click('#compare');
  assert.equal(await page.locator('#differencePosition').innerText(),'0 / 3');
  const check=async index=>{
   assert.equal(await page.locator('#differencePosition').innerText(),`${index+1} / 3`);
   assert(await page.evaluate(index=>{const nav=testApi.navigation();return nav.index===index&&testApi.editors().every((e,i)=>{const range=nav.locations[index][i===0?'left':'right'],selected=e.view.state.selection.main;return selected.from===range.from&&selected.to===range.to})},index));
   await page.waitForFunction(()=>testApi.editors().every(e=>{const scroller=e.view.scrollDOM.getBoundingClientRect(),mark=e.view.dom.querySelector('.cm-current-difference');if(!mark)return false;const rect=mark.getBoundingClientRect();return rect.bottom>scroller.top&&rect.top<scroller.bottom}));
  };
  await page.click('#nextDifference');await check(0);
  await page.keyboard.press('F7');await check(1);
  await page.keyboard.press('F7');await check(2);
  await page.click('#nextDifference');await check(0);
  await page.keyboard.press('Shift+F7');await check(2);
  await page.click('#previousDifference');await check(1);
  // Expand both containing blocks when the target is hidden by nested folds.
  await page.click('[data-fold="result"]');assert(await page.evaluate(()=>testApi.editors().every(e=>e.foldedCount()>0)));
  await page.click('#nextDifference');await check(2);
  // Paired exact jumps must not be overwritten by proportional scrolling.
  await page.waitForFunction(()=>{const now=performance.now(),positions=testApi.editors().map(e=>e.view.scrollDOM.scrollTop),last=window.navPosition;if(!last||positions.some((v,i)=>Math.abs(v-last.positions[i])>1)){window.navPosition={positions,time:now};return false}return now-last.time>150});
  await check(2);
  // Manual scrolling resumes synchronization after a navigation jump.
  await page.click('[data-unfold="result"]');await page.locator('.result-code .cm-scroller').first().hover();await page.mouse.wheel(0,-250);
  await page.waitForFunction(()=>{const [a,b]=testApi.editors().map(e=>e.view.scrollDOM);return Math.abs(a.scrollTop/(a.scrollHeight-a.clientHeight)-b.scrollTop/(b.scrollHeight-b.clientHeight))<.01});
  await page.evaluate(()=>testApi.inputEditors.left.setValue('{"edited":true}'));
  assert(await page.locator('#nextDifference').isDisabled());assert.equal(await page.locator('#differencePosition').innerText(),'请重新对比');assert.equal(await page.locator('.cm-current-difference').count(),0);
  await page.click('#clear');assert.equal(await page.locator('#differencePosition').innerText(),'0 / 0');
  await page.evaluate(()=>{for(const e of Object.values(testApi.inputEditors))e.setValue('same')});await page.click('#compare');assert(await page.locator('#nextDifference').isDisabled());
  // Pure insertion/deletion anchors and an empty pane remain navigable.
  for(const [left,right] of [['','added'],['removed','']]){
   await page.evaluate(([l,r])=>{testApi.inputEditors.left.setValue(l);testApi.inputEditors.right.setValue(r)},[left,right]);await page.click('#compare');await page.click('#previousDifference');
   assert.equal(await page.locator('#differencePosition').innerText(),'1 / 1');assert.equal(await page.locator('.cm-current-difference').count(),2);
  }
  await page.setViewportSize({width:600,height:950});
  assert(await page.locator('#nextDifference').isVisible());assert(await page.locator('#previousDifference').isVisible());
  assert.deepEqual(errors,[]);console.log('PASS: grouped differences, paired exact navigation, counters, first/last wrap, F7/Shift+F7, nested fold expansion, scroll resumption, stale/clear/equal states, empty-side anchors and narrow layout.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
