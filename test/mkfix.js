const fs=require('fs'),XT=require('../src/xmlcore.js');
const A=process.argv[2];
const src=fs.readFileSync(A+'/MSTsN.426441.001.dchxml','utf8');
const r=XT.parse(src,0,src.length,XT.SKIP_PRJ);
const S=r.ch.find(n=>n.t==='Source');
console.log(S.ch.map(c=>c.t).join(','));
const L=XT.kid(S,'Library');
console.log(L.a, L.ch.map(c=>c.t));
let lib=XT.raw(src,L);
// add Name/Hint
lib=lib.replace(/^<Library /,'<Library Name="Test comps" Hint="" ');
const nl='\r\n';
fs.writeFileSync('test/fix.elixml','\ufeff<?xml version="1.0" encoding="utf-8"?>'+nl+lib.replace(/^\ufeff/,'')+nl);
const PL=XT.kid(L,'Library');
let pl=XT.raw(src,PL).replace(/^<Library /,'<Library Name="Test pats" Hint="" ');
fs.writeFileSync('test/fix.libxml','\ufeff<?xml version="1.0" encoding="utf-8"?>'+nl+pl+nl);
console.log(src.slice(0,200));
