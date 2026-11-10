import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,drawSelection,Decoration,placeholder} from '@codemirror/view';
import {foldGutter,codeFolding,foldAll,unfoldAll,foldKeymap,syntaxHighlighting,defaultHighlightStyle,bracketMatching,indentOnInput,StreamLanguage,ensureSyntaxTree,foldable,foldedRanges} from '@codemirror/language';
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
 '.cm-removed':{backgroundColor:'#f8e1db',textDecoration:'line-through',boxShadow:'0 1px 0 #dcaa9a'}
});
export function create(parent,{value='',language='json',readOnly=false,label='代码',changes=[],onChange}={}){
 const languageSlot=new Compartment();
 const decorations=[];let at=0;for(const chunk of changes){const end=at+chunk.text.length;if(end>at&&chunk.type!=='same')decorations.push(Decoration.mark({class:chunk.type==='add'?'cm-added':'cm-removed'}).range(at,end));at=end;}
 const view=new EditorView({parent,state:EditorState.create({doc:value,extensions:[languageSlot.of(languageExtensions(language,readOnly)),lineNumbers(),foldGutter({openText:'⌄',closedText:'›'}),codeFolding({placeholderText:' … '}),syntaxHighlighting(defaultHighlightStyle),bracketMatching(),indentOnInput(),drawSelection(),history(),keymap.of([...foldKeymap,...defaultKeymap,...historyKeymap,indentWithTab]),theme,EditorView.lineWrapping,EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),EditorView.contentAttributes.of({'aria-label':label,spellcheck:'false'}),EditorView.decorations.of(Decoration.set(decorations)),...(!readOnly?[EditorState.changeFilter.of(tr=>!tr.docChanged||tr.newDoc.length<=20000)]:[]),EditorView.updateListener.of(update=>{if(update.docChanged)onChange?.(update.state.doc.toString());})]})});
 return {view,getValue(){return view.state.doc.toString();},foldedCount(){let count=0;foldedRanges(view.state).between(0,view.state.doc.length,()=>count++);return count;},setValue(value){if(value!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},setLanguage(name){view.dispatch({effects:languageSlot.reconfigure(languageExtensions(name,readOnly))});},fold(){ensureSyntaxTree(view.state,view.state.doc.length,200);return foldAll(view);},unfold(){return unfoldAll(view);},focus(){view.focus();},destroy(){view.destroy();}};
}
// Exposed for deterministic parser checks without a browser renderer.
export function ranges(value,language){const state=EditorState.create({doc:value,extensions:[mode(language),codeFolding()]});ensureSyntaxTree(state,state.doc.length,1000);const result=[];for(let n=1;n<=state.doc.lines;n++){const line=state.doc.line(n);const range=foldable(state,line.from,line.to);if(range)result.push(range);}return result;}
