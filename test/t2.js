const fs=require('fs');global.XT=require('../src/xmlcore.js');global.DT=require('../src/libmodel.js');global.FSX=require('../src/fsx.js');const XR=require('../src/xref.js');
const A=process.env.HOME+'/.perplexity/attachments/dabf929f5bbb43b8bc8137b053e21a6f/';
let t=Date.now();
const sch=XR.parseProject(fs.readFileSync(A+'MSTsN.426441.001.dchxml','utf8'),{name:'MSTsN.426441.001.dchxml'});
const pcb=XR.parseProject(fs.readFileSync(A+'MSTsN.426441.001-2.dipxml','utf8'),{name:'MSTsN.426441.001-2.dipxml'});
console.log('parse',Date.now()-t,sch.items.length,pcb.items.length,pcb.related);
console.log(sch.items.slice(0,3).map(i=>[i.refdes,i.name,i.base,i.lp.v,i.pat&&i.pat.d.Pattern,i.parts]));
console.log(pcb.items.slice(0,3).map(i=>[i.refdes,i.name,i.link,i.lp.v,i.pat&&i.pat.d.Pattern]));
const op=XR.oldPaths(sch.src);console.log(op.map(o=>[o.old,o.n]));
const E=DT.load(fs.readFileSync('test/fix.elixml','utf8')),L=DT.load(fs.readFileSync('test/fix.libxml','utf8'));
// learn
FSX.st.roots.push({id:'m',win:'C:\\Users\\limar\\OneDrive\\DipTrace\\models3d',files:new Map([['cap smd\\x.step',{rel:'Cap SMD\\x.step'}]]),scanned:true});
const res=XR.run([{lib:E,name:'__user_ic_insoft.elixml'},{lib:L,name:'pats.libxml'}],[{prj:sch,name:'MSTsN.426441.001.dchxml'},{prj:pcb,name:'MSTsN.426441.001-2.dipxml'}]);
const c={};for(const i of res.issues){const k=i.lvl+' '+i.cat;c[k]=(c[k]||0)+1;}console.log(c);
const seen=new Set();for(const i of res.issues){const k=i.cat+i.lvl;if(seen.has(k))continue;seen.add(k);console.log(i.lvl,i.cat,i.where,'|',i.obj,'|',i.msg.slice(0,200));}
console.log(res.matrix.slice(0,3).map(m=>[m.comp,m.pat,m.libxml,m.m3,m.m3st,m.sch.length,m.pcb.length,m.notes]));
console.log('total',Date.now()-t);
