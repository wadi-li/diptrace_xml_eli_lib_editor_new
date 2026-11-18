/* Доступ к папкам Windows через File System Access API: корни, индекс файлов, переменные путей DipTrace */
const FSX = (() => {
  'use strict';
  const INTEREST = /\.(elixml|libxml|eli|lib|step|stp|wrl|vrml|igs|iges|dchxml|dipxml)$/i;
  const DEF = {
    base: 'C:\\Users\\limar\\OneDrive\\DipTrace',
    lib: 'C:\\Users\\limar\\OneDrive\\DipTrace\\lib',
    models: 'C:\\Users\\limar\\OneDrive\\DipTrace\\models3d',
    vars: { '%my3dmodels%': 'C:\\Users\\limar\\OneDrive\\DipTrace\\models3d', '%mylibs%': 'C:\\Users\\limar\\OneDrive\\DipTrace\\lib', '%maindir%': 'C:\\Program Files\\DipTrace', '%standardlibs%': 'C:\\Program Files\\DipTrace\\Lib' }
  };
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const norm = p => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '');
  const low = p => norm(p).toLowerCase();
  const join = (a, b) => norm(a) + '\\' + String(b).replace(/\//g, '\\').replace(/^\\+/, '');
  const base = p => norm(p).split('\\').pop();
  const stem = p => base(p).replace(/\.[^.]+$/, '');
  const ext = p => (base(p).match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();

  const st = { roots: [], vars: { ...DEF.vars }, settings: { lib: DEF.lib, models: DEF.models }, learned: {} };

  /* ---------- IndexedDB для дескрипторов папок ---------- */
  function db() { return new Promise((res, rej) => { const r = indexedDB.open('dtx-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { const d = await db(); return await new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); } catch (e) { return undefined; } }
  async function idbSet(k, v) { try { const d = await db(); await new Promise(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) { } }
  async function persist() {
    await idbSet('roots', st.roots.filter(r => r.handle).map(r => ({ id: r.id, win: r.win, handle: r.handle, role: r.role })));
    try { localStorage.setItem('dtx.fsx', JSON.stringify({ vars: st.vars, settings: st.settings })); } catch (e) { }
  }
  async function restore() {
    try { const j = JSON.parse(localStorage.getItem('dtx.fsx') || 'null'); if (j) { Object.assign(st.vars, j.vars || {}); Object.assign(st.settings, j.settings || {}); } } catch (e) { }
    const saved = (await idbGet('roots')) || [];
    for (const s of saved) if (!st.roots.some(r => r.id === s.id)) st.roots.push({ ...s, files: new Map(), perm: 'prompt', scanned: false });
    for (const r of st.roots) if (r.handle && r.handle.queryPermission) { try { r.perm = await r.handle.queryPermission({ mode: 'readwrite' }); if (r.perm !== 'granted') { const rp = await r.handle.queryPermission({ mode: 'read' }); if (rp === 'granted') r.perm = 'read'; } } catch (e) { r.perm = 'prompt'; } }
    return st.roots;
  }
  async function regrant(r) {
    if (!r.handle) return false;
    try { let p = await r.handle.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') p = (await r.handle.requestPermission({ mode: 'read' })) === 'granted' ? 'read' : p; r.perm = p; return p === 'granted' || p === 'read'; } catch (e) { return false; }
  }
  function guessWin(name, entries) {
    const n = name.toLowerCase();
    if (n === 'diptrace' && entries.includes('lib') && entries.includes('models3d')) return DEF.base;
    if (n === 'lib') return st.settings.lib;
    if (n === 'models3d') return st.settings.models;
    if (n === 'diptrace') return st.vars['%maindir%'];
    return st.settings.lib.replace(/\\lib$/i, '') + '\\' + name;
  }
  async function pick(win, role) {
    const h = await window.showDirectoryPicker({ id: 'dtx-' + (role || 'root'), mode: 'readwrite' });
    const names = []; for await (const [k] of h.entries()) { names.push(k.toLowerCase()); if (names.length > 400) break; }
    const r = { id: 'r' + Date.now(), handle: h, name: h.name, win: win || guessWin(h.name, names), role: role || '', files: new Map(), perm: 'granted', scanned: false };
    return r;
  }
  function addRoot(r) { const old = st.roots.findIndex(x => low(x.win) === low(r.win)); if (old >= 0) st.roots.splice(old, 1, r); else st.roots.push(r); persist(); }
  function removeRoot(r) { st.roots = st.roots.filter(x => x !== r); persist(); }
  // запасной вариант: <input webkitdirectory> — только чтение
  function fromFileList(list, win) {
    const r = { id: 'f' + Date.now(), handle: null, name: '', win, role: 'ro', files: new Map(), perm: 'read', scanned: true };
    for (const f of list) { const parts = (f.webkitRelativePath || f.name).split('/'); r.name = parts[0]; const rel = parts.slice(1).join('\\'); if (INTEREST.test(rel)) r.files.set(rel.toLowerCase(), { rel, file: f, size: f.size, mtime: f.lastModified }); }
    return r;
  }
  async function scan(r, onProgress) {
    if (!r.handle) return r.files;
    const files = new Map(); let n = 0;
    async function walk(dir, pre, depth) {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'directory') { if (depth < 12 && !/^(_backup|\.git|node_modules|\$recycle\.bin)$/i.test(name)) await walk(h, pre + name + '\\', depth + 1); }
        else if (INTEREST.test(name)) { const rel = pre + name; files.set(rel.toLowerCase(), { rel, handle: h, dir }); if (++n % 500 === 0 && onProgress) onProgress(n); }
      }
    }
    await walk(r.handle, '', 0);
    r.files = files; r.scanned = true; return files;
  }
  /* ---------- Пути и переменные ---------- */
  function rootFor(win) {
    const L = low(win); let best = null;
    for (const r of st.roots) { const w = low(r.win); if ((L === w || L.startsWith(w + '\\')) && (!best || w.length > low(best.win).length)) best = r; }
    return best;
  }
  function varToWin(v) {
    v = norm(v); const m = v.match(/^(%[^%\\]+%)(.*)$/);
    if (!m) return v;
    const val = st.vars[m[1].toLowerCase()] || st.vars[m[1]] || st.learned[m[1].toLowerCase()];
    return val ? norm(val) + m[2] : '';
  }
  function winToVar(win, prefer) {
    const L = low(win); let best = null;
    for (const [k, v] of Object.entries(st.vars)) { const w = low(v); if (!w) continue; if (L.startsWith(w + '\\') && (!best || w.length > best[1].length || (w.length === best[1].length && k === prefer))) best = [k, w]; }
    return best ? best[0] + norm(win).slice(best[1].length) : norm(win);
  }
  // Path/Var пары из файлов: учим значения переменных (%projectdir% не учим)
  function learn(path, v) {
    if (!path || !v) return; const m = norm(v).match(/^(%[^%\\]+%)(.*)$/); if (!m) return;
    const k = m[1].toLowerCase(); if (k === '%projectdir%') return;
    const P = norm(path); if (!low(P).endsWith(low(m[2]))) return;
    const val = P.slice(0, P.length - m[2].length); if (!val) return;
    if (!st.vars[k]) st.learned[k] = val;
  }
  function lookup(win) {
    if (!win) return null; const r = rootFor(win); if (!r || !r.scanned) return r ? { root: r, rel: norm(win).slice(norm(r.win).length + 1), entry: undefined } : null;
    const rel = norm(win).slice(norm(r.win).length + 1);
    return { root: r, rel, entry: r.files.get(rel.toLowerCase()) || null };
  }
  /* Наличие файла модели: { st: 'ok'|'miss'|'unk', win, how } */
  function resolve(path, v, projDir) {
    const cands = [];
    if (v) { let w = norm(v); if (/^%projectdir%/i.test(w)) w = projDir ? norm(projDir) + w.slice(12) : ''; else w = varToWin(w); if (w) cands.push(['var', w]); }
    if (path) cands.push(['path', norm(path)]);
    if (!cands.length) return { st: 'none', win: '' };
    let unk = null, miss = null;
    for (const [how, w] of cands) { const L = lookup(w); if (L && L.entry) return { st: 'ok', win: w, how, entry: L.entry, root: L.root }; if (L && L.entry === null) miss = miss || w; else unk = unk || w; }
    if (miss) return { st: 'miss', win: miss };
    return { st: 'unk', win: unk };
  }
  function byName(fname, exts) {
    const b = base(fname).toLowerCase(), s = stem(fname).toLowerCase(), out = [];
    for (const r of st.roots) for (const [k, e] of r.files) { const kb = k.split('\\').pop(); if (kb === b || (exts && kb.replace(/\.[^.]+$/, '') === s && exts.test(kb))) out.push({ root: r, rel: e.rel, entry: e, win: join(r.win, e.rel) }); }
    return out;
  }
  function list(re) { const out = []; for (const r of st.roots) for (const [, e] of r.files) if (re.test(e.rel)) out.push({ root: r, rel: e.rel, entry: e, win: join(r.win, e.rel) }); return out; }
  async function fileOf(e) { return e.file || (await e.handle.getFile()); }
  async function readBytes(e) { return new Uint8Array(await (await fileOf(e)).arrayBuffer()); }
  function decode(u8) {
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(u8); }
    catch (er) { return new TextDecoder('windows-1251').decode(u8); }
  }
  async function readText(e) { return decode(await readBytes(e)); }
  async function dirOf(root, relDir, create) {
    let d = root.handle; if (!d) throw new Error('Папка «' + root.win + '» подключена только для чтения');
    for (const p of norm(relDir).split('\\').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: !!create });
    return d;
  }
  async function writeRel(root, rel, data) {
    const parts = norm(rel).split('\\'); const name = parts.pop();
    const d = await dirOf(root, parts.join('\\'), true);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); await w.write(data); await w.close();
    root.files.set(norm(rel).toLowerCase(), { rel: norm(rel), handle: fh, dir: d });
    return fh;
  }
  async function writeHandle(fh, data) { const w = await fh.createWritable(); await w.write(data); await w.close(); }
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  // Резервная копия рядом: <папка>\_backup\имя.ГГГГММДД_ччммсс.ext
  async function backup(root, rel, bytes) {
    const parts = norm(rel).split('\\'); const name = parts.pop();
    const b = name.replace(/(\.[^.]+)$/, '.' + stamp() + '$1');
    await writeRel(root, [...parts, '_backup', b].join('\\'), bytes);
    root.files.delete([...parts, '_backup', b].join('\\').toLowerCase());
    return [...parts, '_backup', b].join('\\');
  }
  return { st, DEF, supported, norm, low, join, base, stem, ext, restore, regrant, pick, addRoot, removeRoot, fromFileList, scan, rootFor, varToWin, winToVar, learn, lookup, resolve, byName, list, fileOf, readBytes, readText, decode, writeRel, writeHandle, backup, persist, stamp, INTEREST };
})();
if (typeof module !== 'undefined') module.exports = FSX;
