const {chromium}=require('playwright-core');const fs=require('fs');const path=require('path');const assert=require('node:assert/strict');
(async()=>{
const root=path.resolve(__dirname,'../extension');const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});if(process.env.TEST_MAC)await page.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'}));const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('http://diffnote.test/**',async route=>{const file=new URL(route.request().url()).pathname.slice(1)||'index.html';let body=fs.readFileSync(path.join(root,file));if(file==='app.js')body=Buffer.from(body.toString()+'\nwindow.testApi={inputEditors,editors:()=>Object.values(inputEditors).concat(resultEditors)};');await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':JSON.parse(fs.readFileSync(root+'/manifest.json')).content_security_policy.extension_pages}})});
await page.goto('http://diffnote.test/index.html');await page.waitForSelector('.cm-editor');
const docs={json:'{\n  "outer": {\n    "inner": {\n      "value": 1\n    }\n  },\n  "sibling": {\n    "ok": true\n  }\n}',java:'class Demo {\n  void first() {\n    if (true) {\n      run();\n    }\n  }\n  void second() {\n    run();\n  }\n}',xml:'<root>\n  <outer>\n    <inner>\n      value\n    </inner>\n  </outer>\n  <sibling>\n    other\n  </sibling>\n</root>'};
for(const language of ['json','java','xml']){
 await page.selectOption('#language',language);
 const text=docs[language];
 await page.evaluate(text=>{for(const e of Object.values(testApi.inputEditors))e.setValue(text)},text);await page.click('#compare');
 const stats=await page.evaluate(()=>testApi.editors().map(e=>{
  const text=e.getValue(),expected=DiffEditor.ranges(text,document.querySelector('#language').value).length;
  e.view.dispatch({selection:{anchor:0}});e.fold();const all=e.foldedCount();e.fold();const repeated=e.foldedCount();e.unfoldCurrent();const inner=e.foldedCount();e.unfold();const none=e.foldedCount();
  const inside=e.view.state.doc.line(4).from+2;e.view.dispatch({selection:{anchor:inside}});e.foldCurrent();const current=e.foldedCount();e.unfold();
  const from=e.view.state.doc.line(3).from,to=e.view.state.doc.line(5).to;e.view.dispatch({selection:{anchor:from,head:to}});e.foldCurrent();const selected=e.foldedCount();e.unfold();
  return {expected,all,repeated,inner,none,current,selected,preserved:e.getValue()===text};
 }));
 for(const stat of stats){assert(stat.expected>=4);assert.equal(stat.all,stat.expected);assert.equal(stat.repeated,stat.expected);assert.equal(stat.inner,stat.expected-1);assert.equal(stat.none,0);assert.equal(stat.current,1);assert.equal(stat.selected,1);assert(stat.preserved)}
 // Test keyboard commands on all four views, including the read-only results.
 for(let index=0;index<4;index++){
  await page.evaluate(index=>{const e=testApi.editors()[index];e.view.dispatch({selection:{anchor:e.view.state.doc.line(4).from+2}});e.focus()},index);
  await page.keyboard.press(process.env.TEST_MAC?'Meta+Alt+BracketLeft':'Control+Shift+BracketLeft');assert.equal(await page.evaluate(i=>testApi.editors()[i].foldedCount(),index),1);
  await page.keyboard.press(process.env.TEST_MAC?'Meta+Alt+BracketRight':'Control+Shift+BracketRight');assert.equal(await page.evaluate(i=>testApi.editors()[i].foldedCount(),index),0);
  await page.keyboard.press(process.env.TEST_MAC?'Meta+Alt+Shift+BracketLeft':'Control+Alt+BracketLeft');assert.equal(await page.evaluate(i=>testApi.editors()[i].foldedCount(),index),4);
  await page.keyboard.press(process.env.TEST_MAC?'Meta+Alt+Shift+BracketRight':'Control+Alt+BracketRight');
 }
 console.log('PASS',language,': selected/current/nested fold, repeat idempotence, full expansion, text preservation, all 4 views and shortcuts');
}
// Mouse target: caret is at the sibling; hover over inner code, then toolbar.
await page.selectOption('#language','json');await page.evaluate(text=>{testApi.inputEditors.left.setValue(text);testApi.inputEditors.right.setValue(text)},docs.json);await page.click('#compare');
await page.evaluate(()=>{const e=testApi.inputEditors.left;e.view.dispatch({selection:{anchor:e.view.state.doc.line(8).from+3}});e.view.scrollDOM.style.height='250px';document.querySelector('#leftEditor .cm-editor').style.height='250px'});
const coords=await page.evaluate(()=>{const e=testApi.inputEditors.left;const c=e.view.coordsAtPos(e.view.state.doc.line(4).from+3);return {x:c.left+2,y:(c.top+c.bottom)/2}});
await page.mouse.move(coords.x,coords.y);await page.click('[data-current="left"]');
assert.equal(await page.evaluate(()=>testApi.inputEditors.left.foldedCount()),1);
assert(await page.locator('#leftEditor').innerText().then(t=>t.includes('"sibling"')));
assert(!(await page.locator('#leftEditor').innerText()).includes('"value"'));
await page.click('[data-unfold="left"]');
// Exact arbitrary selected block is supported in plain text.
await page.selectOption('#language','plaintext');await page.evaluate(()=>{const e=testApi.inputEditors.left;e.setValue('first\nsecond\nthird\nlast');e.view.dispatch({selection:{anchor:6,head:18}})});await page.click('[data-current="left"]');assert.equal(await page.evaluate(()=>testApi.inputEditors.left.foldedCount()),1);assert((await page.locator('#leftEditor').innerText()).includes('last'));await page.click('[data-unfold="left"]');assert.equal(await page.evaluate(()=>testApi.inputEditors.left.getValue()),'first\nsecond\nthird\nlast');
await page.selectOption('#language','json');await page.click('#example');await page.locator('.shortcut-help summary').click();if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
assert.deepEqual(errors,[]);console.log('PASS: hover targets correct block, exact plain text selection, toolbar preserves selection; no browser errors.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
