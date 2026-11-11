import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,drawSelection,Decoration,placeholder} from '@codemirror/view';
import {foldGutter,codeFolding,foldEffect,unfoldEffect,unfoldAll,syntaxHighlighting,defaultHighlightStyle,bracketMatching,indentOnInput,StreamLanguage,ensureSyntaxTree,foldable,foldedRanges} from '@codemirror/language';
import {defaultKeymap,history,historyKeymap,indentWithTab} from '@codemirror/commands';
import {java} from '@codemirror/lang-java';import {json} from '@codemirror/lang-json';import {xml} from '@codemirror/lang-xml';import {javascript} from '@codemirror/lang-javascript';import {python} from '@codemirror/lang-python';import {html} from '@codemirror/lang-html';import {css} from '@codemirror/lang-css';import {sql} from '@codemirror/lang-sql';import {cpp} from '@codemirror/lang-cpp';import {go} from '@codemirror/lang-go';import {yaml} from '@codemirror/lang-yaml';import {markdown} from '@codemirror/lang-markdown';import {shell} from '@codemirror/legacy-modes/mode/shell';import {csharp} from '@codemirror/legacy-modes/mode/clike';
function mode(name){return ({java,json,xml,javascript,typescript:()=>javascript({typescript:true}),python,'xml-html':html,css,sql,c:cpp,cpp,go,yaml,markdown,bash:()=>StreamLanguage.define(shell),csharp:()=>StreamLanguage.define(csharp)})[name]?.()||[];}
function languageExtensions(name,readOnly){return [mode(name),placeholder(readOnly?'':`在这里粘贴${name==='plaintext'?'文本':name.toUpperCase()+' 代码'}…`)];}
const theme=EditorView.theme({
 '&':{fontSize:'13px',color:'#344b43',backgroundColor:'#fff'},
 '.cm-scroller':{fontFamily:'Consolas,"Microsoft YaHei",monospace',lineHeight:'1.8',overflow:'auto'},
 '.cm-content':{padding:'7px 0',minHeight:'96px'},'.cm-line':{padding:'0 10px'},
 '.cm-gutters':{backgroundColor:'#fafbf8',color:'#97a294',borderRight:'1px solid #e8ece5'},
 '.cm-foldGutter .cm-gutterElement':{cursor:'pointer',padding:'0 5px'},
 '.cm-foldPlaceholder':{background:'#edf2e8',border:'1px solid #cddbc7',borderRadius:'3px',color:'#48714d',padding:'0 5px',cursor:'pointer'},
 '&.cm-focused':{outline:'2px solid #b1d0bd',outlineOffset:'-2px'},
 '.cm-added':{backgroundColor:'#d9efdf',boxShadow:'0 1px 0 #85b795'},
 '.cm-removed':{backgroundColor:'#f8e1db',textDecoration:'line-through',boxShadow:'0 1px 0 #dcaa9a'},
 '.cm-line-added':{backgroundColor:'#eff8f1'},
 '.cm-line-removed':{backgroundColor:'#fff1ed'}
});
function codeRanges(state){
 ensureSyntaxTree(state,state.doc.length,1000);
 const result=[];
 // Visit document lines, including lines hidden inside an already folded block.
 for(let n=1;n<=state.doc.lines;n++){
  const line=state.doc.line(n),range=foldable(state,line.from,line.to);
  if(range)result.push({...range,lineFrom:line.from});
 }
 return result;
}
export function create(parent,{value='',language='json',readOnly=false,label='代码',changes=[],changedLines=[],changeSide='right',onChange}={}){
 const languageSlot=new Compartment();
 let hoverPosition=null;
 function foldEveryLevel(view){
  const effects=codeRanges(view.state).map(range=>foldEffect.of(range));
  if(effects.length)view.dispatch({effects});
  return effects.length>0;
 }
 function foldCurrent(view,useHover=false){
  const {state}=view,selection=state.selection.main;
  let range;
  if(!selection.empty){
   // An explicit selection folds exactly that text, even in plain text mode.
   if(state.doc.lineAt(selection.from).number===state.doc.lineAt(selection.to).number)return false;
   range={from:selection.from,to:selection.to};
  }else{
   const position=useHover&&hoverPosition!==null?hoverPosition:selection.head;
   range=codeRanges(state).filter(r=>r.lineFrom<=position&&position<=r.to).sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];
  }
  if(!range)return false;
  // Do not move the selection into the fold: that would immediately open it.
  view.dispatch({effects:foldEffect.of(range)});
  return true;
 }
 function unfoldCurrent(view,useHover=false){
  const {state}=view,selection=state.selection.main;
  const position=useHover&&hoverPosition!==null?hoverPosition:selection.head;
  const line=state.doc.lineAt(position),candidates=[];
  foldedRanges(state).between(0,state.doc.length,(from,to)=>{
   if(!selection.empty?from<selection.to&&to>selection.from:(from<=position&&to>=position)||(from>=line.from&&from<=line.to))candidates.push({from,to});
  });
  // Only open the current level. Nested folds remain until explicitly expanded.
  const range=candidates.sort((a,b)=>(a.to-a.from)-(b.to-b.from))[0];
  if(!range)return false;
  view.dispatch({effects:unfoldEffect.of(range)});
  return true;
 }
 const foldingKeys=[
  {key:'Ctrl-Shift-[',mac:'Cmd-Alt-[',run:view=>{foldCurrent(view);return true;}},
  {key:'Ctrl-Shift-]',mac:'Cmd-Alt-]',run:view=>{unfoldCurrent(view);return true;}},
  {key:'Ctrl-Alt-[',mac:'Cmd-Alt-Shift-[',run:view=>{foldEveryLevel(view);return true;}},
  {key:'Ctrl-Alt-]',mac:'Cmd-Alt-Shift-]',run:view=>{unfoldAll(view);return true;}}
 ];
 const decorations=[];let at=0;for(const chunk of changes){const end=at+chunk.text.length;if(end>at&&chunk.type!=='same')decorations.push(Decoration.mark({class:chunk.type==='add'?'cm-added':'cm-removed'}).range(at,end));at=end;}
 const doc=EditorState.create({doc:value}).doc;
 for(const number of new Set(changedLines)){
  if(number>=1&&number<=doc.lines)decorations.push(Decoration.line({class:changeSide==='left'?'cm-line-removed':'cm-line-added'}).range(doc.line(number).from));
 }
 const view=new EditorView({parent,state:EditorState.create({doc:value,extensions:[languageSlot.of(languageExtensions(language,readOnly)),lineNumbers(),foldGutter({openText:'⌄',closedText:'›'}),codeFolding({placeholderText:' … '}),syntaxHighlighting(defaultHighlightStyle),bracketMatching(),indentOnInput(),drawSelection(),history(),keymap.of([...foldingKeys,...defaultKeymap,...historyKeymap,indentWithTab]),theme,EditorView.lineWrapping,EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),EditorView.contentAttributes.of({'aria-label':label,spellcheck:'false',...(readOnly?{tabindex:'0'}:{})}),EditorView.domEventHandlers({mousemove(event,view){hoverPosition=view.posAtCoords({x:event.clientX,y:event.clientY});},keydown(){hoverPosition=null;}}),EditorView.decorations.of(Decoration.set(decorations,true)),...(!readOnly?[EditorState.changeFilter.of(tr=>!tr.docChanged||tr.newDoc.length<=20000)]:[]),EditorView.updateListener.of(update=>{if(update.selectionSet||update.docChanged)hoverPosition=null;if(update.docChanged)onChange?.(update.state.doc.toString());})]})});
 return {view,getValue(){return view.state.doc.toString();},foldedCount(){let count=0;foldedRanges(view.state).between(0,view.state.doc.length,()=>count++);return count;},setValue(value){if(value!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},setLanguage(name){unfoldAll(view);hoverPosition=null;view.dispatch({effects:languageSlot.reconfigure(languageExtensions(name,readOnly))});},fold(){return foldEveryLevel(view);},unfold(){return unfoldAll(view);},foldCurrent(){return foldCurrent(view,true);},unfoldCurrent(){return unfoldCurrent(view,true);},focus(){view.focus();},destroy(){view.destroy();}};
}
// Exposed for deterministic parser checks without a browser renderer.
export function ranges(value,language){const state=EditorState.create({doc:value,extensions:[mode(language),codeFolding()]});return codeRanges(state).map(({from,to})=>({from,to}));}
