const $=id=>document.getElementById(id),left=$('left'),right=$('right');let report='';
const language=$('language');
function counts(){syncInputs();for(const [el,id] of [[left,'leftCount'],[right,'rightCount']])$(id).textContent=`${Array.from(el.value).length.toLocaleString()} 字符 · ${el.value?el.value.split(/\r\n?|\n/).length:0} 行`;}
const inputEditors={};let resultEditors=[],disconnectResultScroll=()=>{};
// Use the same scroll progress when documents have different lengths or folds.
function linkResultScroll(editors){
 const scrollers=editors.map(editor=>editor.view.scrollDOM),positions=new WeakMap();
 let frame=0,pending=null,active=null;
 const gestures=['wheel','pointerdown','touchstart','keydown','focusin'];
 function activate(event){active=event.currentTarget;}
 for(const el of scrollers)positions.set(el,{top:el.scrollTop,left:el.scrollLeft});
 function onScroll(event){
  const source=event.currentTarget,last=positions.get(source);
  // CodeMirror may adjust scroll offsets while rendering virtual lines. Only
  // the pane the user is operating may drive the pair, preventing feedback.
  if(active&&source!==active){
   if(Math.abs(source.scrollTop-last.top)>.5||Math.abs(source.scrollLeft-last.left)>.5)queue(active,true,true);
   return;
  }
  active=source;
  const vertical=Math.abs(source.scrollTop-last.top)>.5,horizontal=Math.abs(source.scrollLeft-last.left)>.5;
  positions.set(source,{top:source.scrollTop,left:source.scrollLeft});
  // A scroll applied to the peer is already recorded, so it cannot bounce back.
  if(!vertical&&!horizontal)return;
  queue(source,vertical,horizontal);
 }
 function queue(source,vertical,horizontal){
  pending={source,vertical:vertical||pending?.vertical,horizontal:horizontal||pending?.horizontal};
  if(frame)return;
  frame=requestAnimationFrame(()=>{
   frame=0;const {source,vertical,horizontal}=pending;pending=null;
   const maxTop=source.scrollHeight-source.clientHeight,maxLeft=source.scrollWidth-source.clientWidth;
   for(const target of scrollers){
    if(target===source)continue;
    if(vertical)target.scrollTop=maxTop>0?source.scrollTop/maxTop*(target.scrollHeight-target.clientHeight):0;
    if(horizontal)target.scrollLeft=maxLeft>0?source.scrollLeft/maxLeft*(target.scrollWidth-target.clientWidth):0;
    positions.set(target,{top:target.scrollTop,left:target.scrollLeft});
   }
  });
 }
 const geometry=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{if(active)queue(active,true,true);});
 for(const editor of editors)geometry?.observe(editor.view.contentDOM);
 for(const el of scrollers){el.addEventListener('scroll',onScroll,{passive:true});for(const name of gestures)el.addEventListener(name,activate,{passive:true});}
 return ()=>{geometry?.disconnect();cancelAnimationFrame(frame);for(const el of scrollers){el.removeEventListener('scroll',onScroll);for(const name of gestures)el.removeEventListener(name,activate);}};
}
function linkInputHeights(editors){
 if(typeof ResizeObserver==='undefined')return;
 const elements=Object.values(editors).map(editor=>editor.view.dom),heights=new WeakMap();
 let frame=0,pending=null;
 for(const el of elements)heights.set(el,el.getBoundingClientRect().height);
 const observer=new ResizeObserver(entries=>{
  for(const {target} of entries){
   const height=target.getBoundingClientRect().height;
   if(Math.abs(height-heights.get(target))<.5)continue;
   heights.set(target,height);pending={source:target,height};
  }
  if(!pending||frame)return;
  // Write in the next frame to avoid ResizeObserver feedback during native drag.
  frame=requestAnimationFrame(()=>{
   frame=0;const {source,height}=pending;pending=null;
   for(const target of elements){
    if(target===source)continue;
    heights.set(target,height);target.style.height=height+'px';
   }
  });
 });
 for(const el of elements)observer.observe(el);
}
for(const side of ['left','right'])inputEditors[side]=DiffEditor.create($(side+'Editor'),{value:$(side).value,language:language.value,label:side==='left'?'原始文本代码编辑器':'修改后文本代码编辑器',onChange(value){$(side).value=value;stale();}});
linkInputHeights(inputEditors);
for(const side of ['left','right'])document.querySelector(`label[for="${side}"]`).onclick=()=>inputEditors[side].focus();
function syncInputs(){for(const side of ['left','right'])inputEditors[side].setValue($(side).value);}
function clearResultEditors(){disconnectResultScroll();disconnectResultScroll=()=>{};resultEditors.forEach(editor=>editor.destroy());resultEditors=[];}
function foldTargets(name){return name==='result'?resultEditors:[inputEditors[name]];}
document.querySelectorAll('[data-fold]').forEach(button=>button.onclick=()=>{for(const editor of foldTargets(button.dataset.fold))editor.fold();});
document.querySelectorAll('[data-unfold]').forEach(button=>button.onclick=()=>{for(const editor of foldTargets(button.dataset.unfold))editor.unfold();});
function currentAction(editor,expand=false){if(!editor[expand?'unfoldCurrent':'foldCurrent']())toast(expand?'当前位置没有已折叠的代码块':'请选中多行文本，或将光标 / 鼠标放在可折叠的代码块中');}
document.querySelectorAll('[data-current]').forEach(button=>button.onclick=()=>currentAction(inputEditors[button.dataset.current]));
document.querySelectorAll('[data-expand-current]').forEach(button=>button.onclick=()=>currentAction(inputEditors[button.dataset.expandCurrent],true));
// Keep the editor selection when clicking code toolbar buttons, including result buttons.
document.addEventListener('mousedown',event=>{if(event.target.closest('.code-actions button'))event.preventDefault();});
function stale(){counts();$('status').textContent='内容已更新，请重新对比';$('copy').disabled=true;}
[left,right,$('spaces'),$('case')].forEach(el=>el.addEventListener('input',stale));
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2200);}
const examples={
 plaintext:['本周工作进展\n完成了产品首页设计。\n修复 3 个已知问题。','本周工作进展\n完成了产品首页与详情页设计。\n修复 5 个已知问题。'],
 java:['public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}','public class Hello {\n    public static void main(String[] args) {\n        String name = "DiffNote";\n        System.out.println("Hello, " + name);\n    }\n}'],
 json:['{\n  "name": "DiffNote",\n  "version": 1,\n  "enabled": false\n}','{\n  "name": "DiffNote",\n  "version": 2,\n  "enabled": true\n}'],
 xml:['<?xml version="1.0"?>\n<project>\n  <name>DiffNote</name>\n  <version>1</version>\n</project>','<?xml version="1.0"?>\n<project>\n  <name>DiffNote</name>\n  <version>2</version>\n  <enabled>true</enabled>\n</project>'],
 javascript:['const greet = (name) => `Hello, ${name}`;\nconsole.log(greet("World"));','const greet = (name = "World") => `Hello, ${name}!`;\nconsole.log(greet("DiffNote"));'],
 typescript:['function greet(name: string): string {\n  return "Hello, " + name;\n}','function greet(name: string = "World"): string {\n  return `Hello, ${name}!`;\n}'],
 python:['def greet(name):\n    return "Hello, " + name\n\nprint(greet("World"))','def greet(name="World"):\n    return f"Hello, {name}!"\n\nprint(greet("DiffNote"))'],
 'xml-html':['<main>\n  <h1>Hello</h1>\n</main>','<main class="page">\n  <h1>Hello, DiffNote</h1>\n  <p>Compare your text.</p>\n</main>'],
 css:['.title {\n  color: black;\n  font-size: 16px;\n}','.title {\n  color: green;\n  font-size: 18px;\n}'],
 sql:['SELECT id, name\nFROM users\nWHERE active = 1;','SELECT id, name, email\nFROM users\nWHERE active = 1\nORDER BY name;'],
 bash:['#!/bin/bash\nname="World"\necho "Hello, $name"','#!/bin/bash\nname="DiffNote"\necho "Hello, $name!"'],
 c:['#include <stdio.h>\nint main(void) {\n    printf("Hello\\n");\n    return 0;\n}','#include <stdio.h>\nint main(void) {\n    printf("Hello, DiffNote!\\n");\n    return 0;\n}'],
 cpp:['#include <iostream>\nint main() {\n    std::cout << "Hello";\n}','#include <iostream>\nint main() {\n    std::cout << "Hello, DiffNote!" << std::endl;\n}'],
 csharp:['class Hello {\n    static void Main() {\n        Console.WriteLine("Hello");\n    }\n}','class Hello {\n    static void Main() {\n        Console.WriteLine("Hello, DiffNote!");\n    }\n}'],
 go:['package main\nimport "fmt"\nfunc main() {\n    fmt.Println("Hello")\n}','package main\nimport "fmt"\nfunc main() {\n    fmt.Println("Hello, DiffNote!")\n}'],
 yaml:['name: DiffNote\nversion: 1\nenabled: false','name: DiffNote\nversion: 2\nenabled: true'],
 markdown:['# Hello\n\nA simple text tool.',' # Hello, DiffNote\n\nA **simple** text comparison tool.'.trim()]
};
$('example').onclick=()=>{[left.value,right.value]=examples[language.value]||examples.plaintext;stale();run();};
$('swap').onclick=()=>{[left.value,right.value]=[right.value,left.value];stale();if(report)run();};
$('clear').onclick=()=>{left.value='';right.value='';counts();clearResultEditors();$('result').className='result empty';$('result').innerHTML='<div class="empty-icon">≠</div><h3>让变化浮现</h3><p>输入左右两段文本，点击「开始对比」查看差异</p>';$('summary').hidden=true;$('copy').disabled=true;$('status').textContent='等待对比';report='';inputEditors.left.focus();};
function renderCode(host,parts,side){const chunks=parts.filter(p=>p[side]).map(p=>({text:p[side],type:p.type}));resultEditors.push(DiffEditor.create(host,{value:chunks.map(p=>p.text).join(''),language:language.value,readOnly:true,label:side==='left'?'原始文本对比结果':'修改后文本对比结果',changes:chunks}));}
function run(){if(!left.value&&!right.value){toast('请先输入需要对比的文本');inputEditors.left.focus();return;}const options={spaces:$('spaces').checked,case:$('case').checked};const data=compareText(left.value,right.value,options);clearResultEditors();$('result').className='result';$('result').replaceChildren();const grid=document.createElement('div');grid.className='diff-grid';for(const side of ['left','right']){const pane=document.createElement('section');pane.className='diff-pane';const title=document.createElement('div');title.className='diff-title';title.textContent=side==='left'?'原始文本 · 删除标红':'修改后文本 · 新增标绿';const pre=document.createElement('div');pre.className='result-code';renderCode(pre,data.parts,side);const actions=document.createElement('div');actions.className='code-actions';const editor=resultEditors[resultEditors.length-1];for(const [label,expand] of [['折叠当前',false],['展开当前',true]]){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',(side==='left'?'原始文本结果：':'修改后文本结果：')+label);button.onclick=()=>currentAction(editor,expand);actions.append(button);}title.append(actions);pane.append(title,pre);grid.append(pane);}$('result').append(grid);disconnectResultScroll=linkResultScroll(resultEditors);$('summary').hidden=false;$('summary').replaceChildren();for(const [cls,t] of [['added',`+ 新增 ${data.added} 字符`],['removed',`− 删除 ${data.removed} 字符`],['',data.coarse?'大段差异按整块显示':options.spaces||options.case?'已按所选忽略规则对比':'逐字符精确对比']]){const s=document.createElement('span');s.className=cls;s.textContent=t;$('summary').append(s);}$('status').textContent=data.added||data.removed?'发现差异':options.spaces||options.case?'按所选规则一致':'文本完全一致';report=`文本对比报告 · ${language.selectedOptions[0].textContent}\n新增 ${data.added} 字符，删除 ${data.removed} 字符\n${options.spaces?'已忽略空白\n':''}${options.case?'已忽略大小写\n':''}${data.coarse?'大段差异按整块显示\n':''}\n`+data.parts.map(p=>(p.type==='add'?'+ ':p.type==='delete'?'- ':'  ')+(p.type==='add'?p.right:p.left)).join('');$('copy').disabled=false;}
language.onchange=()=>{for(const editor of Object.values(inputEditors))editor.setLanguage(language.value);const label=language.selectedOptions[0].textContent;for(const [el,name] of [[left,'原始'],[right,'修改后']])el.placeholder=`在这里粘贴${name}${label==='纯文本'?'文本':label+'代码'}…`;if(report&&!$('copy').disabled)run();};
$('compare').onclick=()=>run();$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(report);toast('差异报告已复制');}catch{toast('复制失败，请检查浏览器剪贴板权限');}};document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}});counts();
