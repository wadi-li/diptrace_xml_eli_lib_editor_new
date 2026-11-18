const fs=require('fs');global.XT=require('../src/xmlcore.js');const DT=require('../src/libmodel.js');
for(const f of ['fix.elixml','fix.libxml']){
 const src=fs.readFileSync('test/'+f,'utf8');let t=Date.now();
 const lib=DT.load(src);console.log(f,lib.kind,lib.rows.length,lib.pats.length,Date.now()-t,'ms');
 console.log('identity',DT.build(lib)===src, DT.isDirty(lib));
 const r=lib.rows[0];console.log(JSON.stringify(r.d),r.uf);
 const tx=DT.begin(lib,'x');DT.touch(tx,r);
 if(lib.kind==='e'){DT.setVal(r,'Name','NEW&<"x">');DT.setVal(r,'UF:Test','v1');DT.setVal(r,'SupPartNumber','PN1');DT.cloneRow(lib,r,tx);lib.rows[5].status='del';}
 DT.setVal(r,'M3Rot','90;0;45');DT.setVal(r,'M3Var','%my3dmodels%\\a.step');DT.setVal(r,'PUF:PF','pv');DT.setVal(r,'PatPossibleNames','A | B');
 DT.commit(lib,tx);
 const out=DT.build(lib);const l2=DT.load(out);
 console.log('reload',l2.rows.length,JSON.stringify(l2.rows[0].d),l2.rows[0].uf,l2.rows[0].p&&l2.rows[0].p.uf);
 console.log('rebuild identity',DT.build(l2)===out);
 // ids dense
 const ids=[...out.matchAll(lib.kind==='e'?/<Component Id="(\d+)"/g:/<Pattern Id="(\d+)"/g)].map(m=>+m[1]);console.log('dense',ids.every((v,i)=>v===i),ids.length);
 DT.undo(lib);console.log('undo identity',DT.build(lib)===src);
 fs.writeFileSync('/tmp/out_'+f,out);
 console.log(DT.validate(l2).slice(0,5));
}
