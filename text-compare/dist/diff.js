/* Unicode-aware LCS with bounded memory; preserve exact input in all modes. */
function compareText(a,b,options={}) {
 const tokens=s=>Array.from(s.replace(/\r\n?/g,'\n')).filter(c=>!options.spaces||!(/\s/u.test(c)));
 const aa=tokens(a),bb=tokens(b), key=c=>options.case?c.toLowerCase():c;
 let p=0,e=0;while(p<aa.length&&p<bb.length&&key(aa[p])===key(bb[p]))p++;
 while(e<aa.length-p&&e<bb.length-p&&key(aa[aa.length-1-e])===key(bb[bb.length-1-e]))e++;
 const x=aa.slice(p,aa.length-e),y=bb.slice(p,bb.length-e),parts=[];
 const push=(type,l,r)=>{if(l||r)parts.push({type,left:l,right:r})};
 push('same',aa.slice(0,p).join(''),bb.slice(0,p).join(''));
 let coarse=false;
 if(x.length*y.length>4000000){coarse=true;push('delete',x.join(''),'');push('add','',y.join(''));}
 else {
 const w=y.length+1,dp=new Uint16Array((x.length+1)*w);
 for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)dp[i*w+j]=key(x[i])===key(y[j])?dp[(i+1)*w+j+1]+1:Math.max(dp[(i+1)*w+j],dp[i*w+j+1]);
 let i=0,j=0;while(i<x.length||j<y.length){if(i<x.length&&j<y.length&&key(x[i])===key(y[j])){push('same',x[i++],y[j++]);}else if(i<x.length&&(j===y.length||dp[(i+1)*w+j]>=dp[i*w+j+1]))push('delete',x[i++],'');else push('add','',y[j++]);}
 }
 if(e)push('same',aa.slice(aa.length-e).join(''),bb.slice(bb.length-e).join(''));
 const merged=[];for(const v of parts){const prev=merged.at(-1);if(prev&&prev.type===v.type){prev.left+=v.left;prev.right+=v.right;}else merged.push({...v});}
 return {parts:merged,coarse,added:merged.filter(x=>x.type==='add').reduce((n,x)=>n+Array.from(x.right).length,0),removed:merged.filter(x=>x.type==='delete').reduce((n,x)=>n+Array.from(x.left).length,0)};
}
if(typeof module!=='undefined')module.exports={compareText};
