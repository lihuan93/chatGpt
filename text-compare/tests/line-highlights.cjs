const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'../extension');
const sandbox={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(root+'/diff.js','utf8'),sandbox);const compare=sandbox.module.exports.compareText;
const fixtures=[
 {left:'keep\napple\nsame\nold\nend',right:'keep\nbanana\nsame\nnew\nend',lines:{left:[2,4],right:[2,4]}},
 {left:'a\nc',right:'a\nb\nc',lines:{left:[2],right:[2]}},
 {left:'a\nb\nc',right:'a\nc',lines:{left:[2],right:[2]}},
 {left:'',right:'new\ntext',lines:{left:[1],right:[1,2]}},
 {left:'gone\ntext',right:'',lines:{left:[1,2],right:[1]}},
 {left:'same',right:'same',lines:{left:[],right:[]}},
 {left:'Hello',right:'hello',options:{case:true},lines:{left:[],right:[]}},
 {left:'hello \nworld',right:'hello\n world',options:{spaces:true},lines:{left:[],right:[]}},
 {left:'first\r\n旧🙂\r\nlast',right:'first\n新🙂\nlast',lines:{left:[2],right:[2]}},
 {left:'a\nb',right:'ab',lines:{left:[1],right:[1]}}
];
for(const fixture of fixtures)assert.deepEqual(JSON.parse(JSON.stringify(compare(fixture.left,fixture.right,fixture.options).lineHighlights)),fixture.lines);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://diffnote.test/**',async route=>{
   const file=new URL(route.request().url()).pathname.slice(1)||'index.html';let body=fs.readFileSync(path.join(root,file));
   if(file==='app.js')body=Buffer.from(body.toString()+'\nwindow.testApi={inputEditors,editors:()=>resultEditors};');
   await route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':JSON.parse(fs.readFileSync(root+'/manifest.json')).content_security_policy.extension_pages}});
  });
  await page.goto('http://diffnote.test/index.html');await page.waitForSelector('.cm-editor');await page.selectOption('#language','plaintext');
  for(const fixture of fixtures){
   await page.evaluate(f=>{testApi.inputEditors.left.setValue(f.left);testApi.inputEditors.right.setValue(f.right);document.querySelector('#spaces').checked=!!f.options?.spaces;document.querySelector('#case').checked=!!f.options?.case},fixture);await page.click('#compare');
   for(const [index,side,css] of [[0,'left','cm-line-removed'],[1,'right','cm-line-added']]){
    const result=page.locator('.result-code').nth(index);
    assert.equal(await result.locator('.'+css).count(),fixture.lines[side].length);
    if(fixture.lines[side].length){
     const style=await result.locator('.'+css).first().evaluate(el=>({color:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width}));
     assert.equal(style.color,side==='left'?'rgb(255, 241, 237)':'rgb(239, 248, 241)');assert(style.width>400);
    }
   }
   assert.equal(await page.locator('.source-code .cm-line-added,.source-code .cm-line-removed').count(),0);
  }
  await page.selectOption('#language','json');await page.click('#example');
  const before=await page.locator('.result-code .cm-line-added,.result-code .cm-line-removed').count();assert(before>0);
  await page.click('[data-fold="result"]');await page.click('[data-unfold="result"]');
  assert.equal(await page.locator('.result-code .cm-line-added,.result-code .cm-line-removed').count(),before);
  assert(await page.locator('.cm-added').count()>0);assert(await page.locator('.cm-removed').count()>0);
  const values=await page.evaluate(()=>testApi.editors().map(e=>e.getValue()));
  assert.equal(values[0],await page.evaluate(()=>testApi.inputEditors.left.getValue()));assert.equal(values[1],await page.evaluate(()=>testApi.inputEditors.right.getValue()));
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: paired full-row backgrounds, isolated changes, insert/delete/empty panes, unchanged lines, ignore options, CRLF/Unicode, newline edits, folding, character highlights and text preservation.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
