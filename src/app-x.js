'use strict';
/* ===== Папки, загрузка и сохранение баз, проекты, кросс-проверка, 3D ===== */
let uid = 0;
const entryDirty = E => !!E && (E.forceDirty || DT.isDirty(E.lib));
const prjDirty = X => !!X.dirty;

/* ---------- состояние 3D для таблицы ---------- */
const STLBL = { ok: '✓ найден', miss: '✗ нет файла', unk: '? папка не подключена', none: '✗ путь не задан' };
DT.setModelStatus(p => { const d = p.d; if (d.M3Type !== 'File') return d.M3Type ? '— ' + d.M3Type : '— не задана'; if (!d.M3Path && !d.M3Var) return STLBL.none; return STLBL[FSX.resolve(d.M3Path, d.M3Var).st] || ''; });

/* ---------- список библиотек ---------- */
function libsChanged(light) {
  const sel = $('#libSel'); const cur = S.E ? S.E.id : '';
  const opt = E => `<option value="${E.id}" ${E.id === cur ? 'selected' : ''}>${entryDirty(E) ? '● ' : ''}${esc(E.name)} (${E.lib.rows.length})</option>`;
  const e = S.libs.filter(x => x.lib.kind === 'e'), l = S.libs.filter(x => x.lib.kind === 'l');
  const html = S.libs.length ? (e.length ? `<optgroup label="Компоненты (.elixml)">${e.map(opt).join('')}</optgroup>` : '') + (l.length ? `<optgroup label="Корпуса (.libxml)">${l.map(opt).join('')}</optgroup>` : '') : '<option value="">— нет библиотек —</option>';
  if (sel.innerHTML !== html) sel.innerHTML = html;
  const any = S.libs.some(entryDirty) || S.prjs.some(prjDirty);
  $('#bSave').disabled = !S.E; $('#bSaveAs').disabled = !S.E; $('#bSaveAll').disabled = !any;
  ['#bXlsx', '#bCsv', '#bImp'].forEach(s => $(s).disabled = !S.lib);
  $('#tb').hidden = !S.lib;
  const r = FSX.st.roots; $('#rootsInfo').textContent = r.length ? `папок: ${r.length} · библиотек: ${S.libs.length} · проектов: ${S.prjs.length}` : 'папки не подключены';
  if (!light && S.viewName === 'x') renderXLeft();
}
$('#libSel').addEventListener('change', e => { const E = S.libs.find(x => x.id === e.target.value); if (E) selectLib(E); });
function selectLib(E, recId) {
  if (edit) commitEdit();
  S.E = E; S.lib = E ? E.lib : null; S.cols = []; S.checked = new Set(); S.filters = {}; S.search = ''; S.sort = null; S.chk = null; S.tgt = null; S.mass = null;
  $('#search').value = ''; $('#stFilter').value = 'all';
  S.cur = S.lib ? (S.lib.rows.find(r => r.id === recId) || S.lib.rows[0] || null) : null; S.a = { r: 0, c: 2 }; S.b = { r: 0, c: 2 };
  gridBuilt = false;
  if (S.lib && !S.tpl) { S.tpl = DT.templateFromLib(S.lib, .5); saveTpl(); }
  $('#stFile').textContent = E ? `${E.win || E.name} · ${E.lib.type.replace('DipTrace-', '')} ${E.lib.version} · ${E.lib.rows.length} записей` : 'Библиотека не загружена';
  refresh({ cols: true }); libsChanged();
  if (S.cur && recId) jumpTo(S.cur.id);
}
function learnVars(lib) { for (const p of lib.pats) if (p.d.M3Path && p.d.M3Var) FSX.learn(p.d.M3Path, p.d.M3Var); }
function addLibText(text, meta) {
  const lib = DT.load(text, { name: meta.name });
  lib.oldPaths = XR.oldPaths(text); learnVars(lib);
  const old = S.libs.find(x => (meta.win && x.win && FSX.low(x.win) === FSX.low(meta.win)) || (!meta.win && x.name === meta.name && !x.win));
  const E = { id: old ? old.id : 'L' + (++uid), lib, forceDirty: false, ...meta };
  if (old) S.libs.splice(S.libs.indexOf(old), 1, E); else S.libs.push(E);
  S.libs.sort((a, b) => a.lib.kind.localeCompare(b.lib.kind) || a.name.localeCompare(b.name, 'ru'));
  return E;
}
function libDirRel() { const r = FSX.rootFor(FSX.st.settings.lib); if (!r) return null; const rel = FSX.norm(FSX.st.settings.lib).slice(FSX.norm(r.win).length).replace(/^\\/, ''); return { r, rel: rel ? rel.toLowerCase() + '\\' : '' }; }
async function autoLoad(quiet) {
  const ld = libDirRel(); if (!ld || !ld.r.scanned) { if (!quiet) toast('Папка библиотек ' + FSX.st.settings.lib + ' не подключена'); return 0; }
  const list = [...ld.r.files.values()].filter(e => /\.(elixml|libxml)$/i.test(e.rel) && e.rel.toLowerCase().startsWith(ld.rel) && !/\\_backup\\/i.test('\\' + e.rel));
  let n = 0, errs = [];
  for (const e of list) {
    const win = FSX.join(ld.r.win, e.rel); const ex = S.libs.find(x => x.win && FSX.low(x.win) === FSX.low(win));
    if (ex && entryDirty(ex)) continue;
    try { const text = await FSX.readText(e); addLibText(text, { name: FSX.base(e.rel), win, root: ld.r, rel: e.rel, handle: e.handle || null }); n++; }
    catch (er) { errs.push(FSX.base(e.rel) + ': ' + er.message); }
  }
  S.oldLibFiles = [...ld.r.files.values()].filter(e => /\.(eli|lib)$/i.test(e.rel) && e.rel.toLowerCase().startsWith(ld.rel)).map(e => e.rel);
  if (errs.length) toast('Не загружены: ' + errs.slice(0, 3).join('; '), 6000);
  if (!S.E && S.libs.length) selectLib(S.libs[0]); else if (S.E) { const E = S.libs.find(x => x.id === S.E.id); selectLib(E || S.libs[0], S.cur && S.cur.id); }
  libsChanged();
  return n;
}
async function openLibFiles(files, handles) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i], h = handles ? handles[i] : null;
    try {
      const text = FSX.decode(new Uint8Array(await f.arrayBuffer()));
      if (/<Source\s/.test(text.slice(0, 400))) { await addProjectText(text, { name: f.name, handle: h }); continue; }
      let meta = { name: f.name, handle: h, win: '', root: null, rel: '' };
      if (h) for (const r of FSX.st.roots) if (r.handle && r.handle.resolve) { try { const p = await r.handle.resolve(h); if (p) { meta.root = r; meta.rel = p.join('\\'); meta.win = FSX.join(r.win, meta.rel); break; } } catch (e) { } }
      const E = addLibText(text, meta); selectLib(E);
    } catch (er) { toast(f.name + ': ' + er.message, 6000); }
  }
  libsChanged();
}
$('#bOpen').onclick = async () => {
  if (window.showOpenFilePicker) {
    try { const hs = await window.showOpenFilePicker({ id: 'dtx-lib', multiple: true, types: [{ description: 'Базы и проекты DipTrace XML', accept: { 'application/xml': ['.elixml', '.libxml', '.dchxml', '.dipxml'] } }] }); const fs = await Promise.all(hs.map(h => h.getFile())); openLibFiles(fs, hs); } catch (e) { }
  } else $('#fLib').click();
};
$('#fLib').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) openLibFiles(fs); });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  const items = [...e.dataTransfer.items].filter(i => i.kind === 'file'); const hs = [], fs = [];
  for (const it of items) { let h = null; try { if (it.getAsFileSystemHandle) h = await it.getAsFileSystemHandle(); } catch (er) { } const f = it.getAsFile(); if (f) { fs.push(f); hs.push(h && h.kind === 'file' ? h : null); } }
  if (fs.length === 1 && /\.(xlsx|csv)$/i.test(fs[0].name) && S.lib) { importTableFile(fs[0]); return; }
  if (fs.length === 1 && /\.(step|stp)$/i.test(fs[0].name)) { setView('3d'); previewFile(fs[0], fs[0].name); return; }
  openLibFiles(fs, hs);
});

/* ---------- сохранение ---------- */
async function ensureWrite(h) { try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true; return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { return false; } }
async function writeWithBackup(E, text) {
  // E: { handle, root, rel, name } — запись на место, копия исходного файла в <папка>\_backup\
  const h = E.handle; if (!h) return false;
  if (!(await ensureWrite(h))) throw new Error('Нет разрешения на запись в файл ' + E.name);
  const cur = new Uint8Array(await (await h.getFile()).arrayBuffer());
  let bk = '';
  if (E.root && E.root.handle) bk = await FSX.backup(E.root, E.rel, cur);
  else { const lr = libDirRel(); if (lr && lr.r.handle) bk = FSX.join(lr.r.win, await FSX.backup(lr.r, lr.rel + 'projects\\' + E.name, cur)); }
  await FSX.writeHandle(h, new Blob([text], { type: 'application/xml' }));
  return bk || true;
}
async function confirmErrors(E) {
  const v = DT.validate(E.lib).filter(x => x.lvl === 'err'); if (!v.length) return true;
  const r = await modal('Перед сохранением найдены ошибки: ' + E.name, `<p>Ошибок: <b>${v.length}</b>.</p><div style="max-height:300px;overflow:auto">${v.slice(0, 300).map(x => `<div class="msg"><span class="l err">ошибка</span> ${x.id ? '#' + x.id + ' ' + esc(x.name) + ': ' : ''}${esc(x.msg)}</div>`).join('')}</div>`, [{ t: 'Отмена', v: 0 }, { t: 'Сохранить всё равно', v: 1, pri: true }]);
  return r === 1;
}
async function saveEntry(E, as) {
  if (!(await confirmErrors(E))) return false;
  const text = DT.build(E.lib);
  try {
    if (as) {
      if (window.showSaveFilePicker) { const ext = E.lib.kind === 'e' ? '.elixml' : '.libxml'; const h = await window.showSaveFilePicker({ suggestedName: E.name.replace(/(\.[^.]+)$/, '_' + stamp() + '$1'), types: [{ description: 'DipTrace XML', accept: { 'application/xml': [ext] } }] }); await FSX.writeHandle(h, new Blob([text])); toast('Сохранено: ' + h.name); }
      else download(new Blob([text], { type: 'application/xml' }), E.name.replace(/(\.[^.]+)$/, '_' + stamp() + '$1'));
      return true;
    }
    if (E.handle) { const bk = await writeWithBackup(E, text); toast(`Сохранено: ${E.name}` + (typeof bk === 'string' ? ` · копия: ${bk}` : ''), 4500); }
    else { download(new Blob([text], { type: 'application/xml' }), E.name); toast('Файл выгружен загрузкой: папка не подключена, запись на место невозможна', 4500); }
  } catch (er) { if (er.name !== 'AbortError') await modal('Ошибка сохранения', `<p class="err">${esc(er.message)}</p>`); return false; }
  const keep = S.E === E && S.cur ? rowName(S.cur) : null;
  const lib = DT.load(text, E.lib.info); lib.oldPaths = XR.oldPaths(text); E.lib = lib; E.forceDirty = false;
  if (S.E === E) { const r = keep ? lib.rows.find(x => rowName(x) === keep) : null; selectLib(E, r && r.id); }
  libsChanged(); return true;
}
$('#bSave').onclick = () => S.E && saveEntry(S.E);
$('#bSaveAs').onclick = () => S.E && saveEntry(S.E, true);
$('#bSaveAll').onclick = async () => {
  const L = S.libs.filter(entryDirty), P = S.prjs.filter(prjDirty);
  if (!L.length && !P.length) return;
  if (await modal('Сохранить всё', `<p>Будут сохранены на место (копии исходных — в <code>_backup</code>):</p><ul>${L.map(E => `<li>${esc(E.win || E.name)}${E.handle ? '' : ' <span class="muted">(загрузкой)</span>'}</li>`).join('')}${P.map(X => `<li>${esc(X.name)}${X.handle ? '' : ' <span class="muted">(загрузкой)</span>'}</li>`).join('')}</ul>`, [{ t: 'Отмена', v: 0 }, { t: 'Сохранить', v: 1, pri: true }]) !== 1) return;
  for (const E of L) await saveEntry(E);
  for (const X of P) await saveProject(X);
};
document.addEventListener('keydown', e => { const ctl = e.ctrlKey || e.metaKey; if (ctl && (e.key === 's' || e.key === 'ы')) { e.preventDefault(); if (e.shiftKey) $('#bSaveAll').click(); else if (S.E) saveEntry(S.E); } });
window.addEventListener('beforeunload', e => { if (S.libs.some(entryDirty) || S.prjs.some(prjDirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- папки ---------- */
function banner() {
  const need = FSX.st.roots.filter(r => r.handle && r.perm !== 'granted' && r.perm !== 'read');
  const needP = S.prjPending && S.prjPending.length;
  const b = $('#banner');
  if (!need.length && !needP) { b.hidden = true; b.innerHTML = ''; return; }
  b.hidden = false; b.className = 'banner';
  b.innerHTML = `<span>Браузер просит подтвердить доступ к ранее подключённым папкам${need.length ? ': ' + need.map(r => esc(r.win)).join(', ') : ''}${needP ? ` и к ${S.prjPending.length} проектам` : ''}.</span><button class="pri small" id="bGrant">Разрешить доступ</button>`;
  $('#bGrant').onclick = async () => { for (const r of need) await FSX.regrant(r); if (needP) await restoreProjects(true); await scanAll(); banner(); };
}
async function scanAll(force) {
  for (const r of FSX.st.roots) if ((r.perm === 'granted' || r.perm === 'read') && r.handle && (force || !r.scanned)) {
    $('#rootsInfo').innerHTML = `<span class="spin"></span> индексирую ${esc(r.win)}…`;
    try { await FSX.scan(r, n => $('#rootsInfo').innerHTML = `<span class="spin"></span> ${esc(r.name)}: ${n} файлов…`); } catch (er) { toast('Не удалось прочитать папку ' + r.win + ': ' + er.message, 5000); }
  }
  await autoLoad(true);
  if (S.lib) refresh();
  if (S.viewName === 'x' && S.xres) runCheck();
  libsChanged();
}
async function askWin(r) {
  const b = [{ t: 'Отмена', v: 0 }, { t: 'Подключить', v: 1, pri: true }]; b.onOpen = bg => S._aw = bg;
  const res = await modal('Путь Windows для папки «' + r.name + '»', `<p>Браузер не сообщает полный путь выбранной папки. Укажите его — он нужен, чтобы сопоставлять пути из баз (Path и %переменные%) с файлами:</p><input id="awPath" style="width:100%" value="${esc(r.win)}"><p class="muted">Например: <code>${esc(FSX.DEF.base)}</code>, <code>${esc(FSX.st.settings.models)}</code>, <code>C:\\Program Files\\DipTrace\\models3d</code>.</p>`, b);
  if (res !== 1) return false; r.win = FSX.norm(S._aw.querySelector('#awPath').value.trim()) || r.win; return true;
}
async function dirsDialog() {
  const st = FSX.st;
  const rows = st.roots.map((r, i) => { const n = [...r.files.values()]; const steps = n.filter(e => /\.(step|stp)$/i.test(e.rel)).length, libs = n.filter(e => /\.(elixml|libxml)$/i.test(e.rel)).length;
    return `<tr><td><input data-rw="${i}" value="${esc(r.win)}" style="width:100%"></td><td class="nw">${esc(r.name || '')}</td><td class="nw">${r.scanned ? `STEP: ${steps}, баз: ${libs}` : '—'}</td><td class="nw">${r.handle ? (r.perm === 'granted' ? '<span class="ok">чтение и запись</span>' : r.perm === 'read' ? '<span class="warn">только чтение</span>' : '<span class="err">нужно подтвердить</span>') : '<span class="warn">только чтение, на сеанс</span>'}</td><td class="nw">${r.handle && r.perm !== 'granted' ? `<button class="small" data-rg="${i}">Доступ</button>` : ''}<button class="small" data-rs="${i}" ${r.handle ? '' : 'disabled'}>Обновить</button><button class="small" data-rx="${i}">×</button></td></tr>`; }).join('');
  const vars = Object.entries(st.vars).map(([k, v]) => `<label>${esc(k)}</label><input data-var="${esc(k)}" value="${esc(v)}">`).join('');
  const learned = Object.entries(st.learned).filter(([k]) => !st.vars[k]).map(([k, v]) => `<div><code>${esc(k)}</code> = ${esc(v)}</div>`).join('');
  const html = `${FSX.supported ? '' : '<p class="err">Браузер не поддерживает File System Access API — работа с папками недоступна. Используйте Chrome, Edge или Comet.</p>'}
  <h3>Подключённые папки</h3>
  <table class="t"><tr><th>Путь Windows</th><th>Папка</th><th>Индекс</th><th>Доступ</th><th></th></tr>${rows || '<tr><td colspan="5" class="muted">Нет подключённых папок</td></tr>'}</table>
  <div class="row"><button class="pri" data-a="base" ${FSX.supported ? '' : 'disabled'}>Подключить папку DipTrace…</button><button data-a="other" ${FSX.supported ? '' : 'disabled'}>Подключить другую папку…</button><button data-a="ro" title="Для C:\\Program Files\\DipTrace\\models3d: Chrome не даёт прямой доступ к Program Files, папка читается через выбор каталога (только чтение, до закрытия вкладки)">Добавить папку только для чтения…</button></div>
  <p class="muted">Рекомендуется подключить <code>${esc(FSX.DEF.base)}</code> целиком: в ней <code>lib\\</code> (базы) и <code>models3d\\</code> (модели). Стандартные модели DipTrace (<code>%maindir%\\models3d</code>) — кнопкой «только для чтения».</p>
  <h3>Пути</h3><div class="f"><label>Папка баз</label><input id="dLib" value="${esc(st.settings.lib)}"><label>Папка 3D-моделей</label><input id="dMod" value="${esc(st.settings.models)}"></div>
  <p class="muted">Все .elixml и .libxml из папки баз (включая подпапки, кроме _backup) загружаются автоматически. Новые модели копируются в папку 3D-моделей.</p>
  <h3>Переменные путей DipTrace</h3><div class="f">${vars}</div>${learned ? `<details><summary>Определены по файлам</summary>${learned}</details>` : ''}`;
  const b = [{ t: 'Закрыть', v: 0 }, { t: 'Применить и перечитать', v: 1, pri: true }];
  b.onOpen = bg => {
    bg.addEventListener('click', async e => {
      const t = e.target; if (t.tagName !== 'BUTTON') return;
      if (t.dataset.a === 'base' || t.dataset.a === 'other') {
        try { const r = await FSX.pick(null, t.dataset.a); if (!(await askWin(r))) return; FSX.addRoot(r); bg.remove(); await FSX.scan(r); await scanAll(); dirsDialog(); } catch (er) { if (er.name !== 'AbortError') toast(er.message, 5000); }
      }
      if (t.dataset.a === 'ro') { S._roCb = async files => { const r0 = FSX.fromFileList(files, ''); r0.win = FSX.st.vars['%maindir%'] + '\\' + r0.name; if (!(await askWin(r0))) return; FSX.addRoot(r0); bg.remove(); await scanAll(); dirsDialog(); }; $('#fDirRO').click(); }
      if (t.dataset.rg) { await FSX.regrant(st.roots[+t.dataset.rg]); bg.remove(); await scanAll(); dirsDialog(); }
      if (t.dataset.rs) { const r = st.roots[+t.dataset.rs]; t.innerHTML = '<span class="spin"></span>'; await FSX.scan(r); bg.remove(); await scanAll(); dirsDialog(); }
      if (t.dataset.rx) { FSX.removeRoot(st.roots[+t.dataset.rx]); bg.remove(); libsChanged(); dirsDialog(); }
    });
    S._dd = bg;
  };
  if (await modal('Папки и пути', html, b, 'wide') !== 1) return;
  const bg = S._dd;
  bg.querySelectorAll('[data-rw]').forEach(i => { st.roots[+i.dataset.rw].win = FSX.norm(i.value.trim()); });
  bg.querySelectorAll('[data-var]').forEach(i => { st.vars[i.dataset.var] = FSX.norm(i.value.trim()); });
  st.settings.lib = FSX.norm(bg.querySelector('#dLib').value.trim()); st.settings.models = FSX.norm(bg.querySelector('#dMod').value.trim());
  await FSX.persist(); await scanAll();
}
$('#bDirs').onclick = dirsDialog;
$('#fDirRO').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length && S._roCb) S._roCb(fs); });

/* ---------- проекты ---------- */
async function addProjectText(text, meta) {
  const prj = XR.parseProject(text, { name: meta.name });
  const old = S.prjs.find(x => x.name === meta.name);
  const X = { id: old ? old.id : 'P' + (++uid), prj, text, dirty: false, ...meta };
  if (old) S.prjs.splice(S.prjs.indexOf(old), 1, X); else S.prjs.push(X);
  if (meta.handle) persistProjects();
  libsChanged(); return X;
}
async function persistProjects() { await (async () => { try { const d = await new Promise((res, rej) => { const r = indexedDB.open('dtx-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(S.prjs.filter(x => x.handle).map(x => ({ name: x.name, handle: x.handle })), 'projects'); } catch (e) { } })(); }
async function restoreProjects(ask) {
  let list = [];
  try { const d = await new Promise((res, rej) => { const r = indexedDB.open('dtx-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); list = await new Promise(res => { const q = d.transaction('kv').objectStore('kv').get('projects'); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { }
  S.prjPending = [];
  for (const it of list) {
    if (S.prjs.some(x => x.name === it.name)) continue;
    try { let p = await it.handle.queryPermission({ mode: 'read' }); if (p !== 'granted' && ask) p = await it.handle.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') { S.prjPending.push(it); continue; }
      const f = await it.handle.getFile(); await addProjectText(FSX.decode(new Uint8Array(await f.arrayBuffer())), { name: it.name, handle: it.handle }); } catch (e) { }
  }
}
async function saveProject(X) {
  try {
    if (X.handle) { const bk = await writeWithBackup({ handle: X.handle, root: X.root || null, rel: X.rel || '', name: X.name }, X.text); toast(`Сохранено: ${X.name}` + (typeof bk === 'string' ? ` · копия: ${bk}` : ''), 4500); }
    else { download(new Blob([X.text], { type: 'application/xml' }), X.name); toast('Проект выгружен загрузкой (нет доступа к файлу на месте)', 4500); }
    X.dirty = false; libsChanged(); return true;
  } catch (er) { await modal('Ошибка сохранения проекта', `<p class="err">${esc(er.message)}</p>`); return false; }
}
async function addProjectsPicker() {
  if (window.showOpenFilePicker) {
    try { const hs = await window.showOpenFilePicker({ id: 'dtx-prj', multiple: true, types: [{ description: 'Схемы и платы DipTrace XML', accept: { 'application/xml': ['.dchxml', '.dipxml'] } }] });
      for (const h of hs) { const f = await h.getFile(); let meta = { name: f.name, handle: h }; for (const r of FSX.st.roots) if (r.handle && r.handle.resolve) { try { const p = await r.handle.resolve(h); if (p) { meta.root = r; meta.rel = p.join('\\'); meta.win = FSX.join(r.win, meta.rel); break; } } catch (e) { } }
        try { await addProjectText(FSX.decode(new Uint8Array(await f.arrayBuffer())), meta); } catch (er) { toast(f.name + ': ' + er.message, 5000); } }
    } catch (e) { }
  } else $('#fPrj').click();
  renderXLeft();
}
$('#fPrj').addEventListener('change', async e => { for (const f of [...e.target.files]) { try { await addProjectText(FSX.decode(new Uint8Array(await f.arrayBuffer())), { name: f.name }); } catch (er) { toast(f.name + ': ' + er.message, 5000); } } e.target.value = ''; renderXLeft(); });
async function projectsFromRoots() {
  const list = FSX.list(/\.(dchxml|dipxml)$/i).filter(m => !/\\_backup\\/i.test('\\' + m.rel));
  if (!list.length) { toast('В подключённых папках нет файлов .dchxml / .dipxml'); return; }
  const b = [{ t: 'Отмена', v: 0 }, { t: 'Добавить', v: 1, pri: true }]; b.onOpen = bg => S._pr = bg;
  if (await modal('Проекты в подключённых папках', `<div class="colchooser" style="max-height:420px">${list.map((m, i) => `<label><input type="checkbox" data-i="${i}"> ${esc(m.win)}</label>`).join('')}</div>`, b) !== 1) return;
  for (const i of [...S._pr.querySelectorAll('input:checked')].map(x => +x.dataset.i)) { const m = list[i]; try { await addProjectText(await FSX.readText(m.entry), { name: FSX.base(m.rel), handle: m.entry.handle || null, root: m.root, rel: m.rel, win: m.win }); } catch (er) { toast(er.message, 5000); } }
  renderXLeft();
}

/* ---------- исправление устаревших путей .eli/.lib ---------- */
function checkLibTarget(p) {
  let w = FSX.norm(p); if (/^%projectdir%/i.test(w)) return { st: 'unk' };
  w = FSX.varToWin(w); if (!w) return { st: 'unk' };
  const L = FSX.lookup(w); const byName = S.libs.some(E => E.name.toLowerCase() === FSX.base(w).toLowerCase());
  if (L && L.entry) return { st: 'ok' }; if (byName) return { st: 'ok', note: 'загружена' }; if (L && L.entry === null) return { st: 'miss' }; return { st: 'unk' };
}
async function fixPathsDialog(T, kind) {
  const src = kind === 'prj' ? T.text : DT.build(T.lib);
  const items = XR.oldPaths(src); if (!items.length) { toast('Устаревших путей нет'); return; }
  const rows = items.map((it, i) => { const nw = XR.suggestNew(it.old); const c = checkLibTarget(nw);
    return `<tr><td><input type="checkbox" data-i="${i}" ${c.st !== 'miss' ? 'checked' : ''}></td><td>${esc(it.old)}</td><td><input data-n="${i}" value="${esc(nw)}" style="width:100%"></td><td class="nw">${c.st === 'ok' ? '<span class="ok">✓ есть</span>' : c.st === 'miss' ? '<span class="err">✗ нет файла</span>' : '<span class="warn">? не проверено</span>'}</td><td>${it.n}</td></tr>`; }).join('');
  const b = [{ t: 'Отмена', v: 0 }, { t: kind === 'prj' ? 'Исправить и сохранить проект' : 'Исправить', v: 1, pri: true }]; b.onOpen = bg => S._fp = bg;
  const r = await modal('Устаревшие пути .eli/.lib — ' + (T.name), `<p>DipTrace 4.x+ хранит базы в XML: <code>.eli → .elixml</code>, <code>.lib → .libxml</code>. Отмеченные пути будут заменены в тегах <code>&lt;Path&gt;</code> и <code>&lt;Var&gt;</code> (LibPath компонентов и ссылки на библиотеки). Остальной текст файла не меняется.</p>
    <table class="t"><tr><th></th><th>Было</th><th>Станет</th><th>Файл</th><th>Вхождений</th></tr>${rows}</table>
    ${kind === 'prj' ? '<p class="muted">Перед записью исходный проект копируется в _backup. После исправления откройте проект в DipTrace и при необходимости обновите компоненты из библиотек.</p>' : ''}`, b, 'wide');
  if (r !== 1) return;
  const map = new Map(); S._fp.querySelectorAll('input[data-i]:checked').forEach(c => { const i = +c.dataset.i; const v = S._fp.querySelector(`[data-n="${i}"]`).value.trim(); if (v && v !== items[i].old) map.set(items[i].old, v); });
  if (!map.size) return;
  const fixed = XR.fixPaths(src, map);
  if (kind === 'prj') { T.text = fixed; T.prj = XR.parseProject(fixed, { name: T.name }); T.dirty = true; await saveProject(T); }
  else { const lib = DT.load(fixed, T.lib.info); lib.oldPaths = XR.oldPaths(fixed); T.lib = lib; T.forceDirty = true; if (S.E === T) selectLib(T); toast('Пути исправлены. Сохраните библиотеку.'); }
  libsChanged(); if (S.xres) runCheck();
}

/* ---------- виды ---------- */
$('#views').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setView(b.dataset.v); });
function setView(v) {
  S.viewName = v; $$('#views button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $$('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  if (v === 'x') { renderXLeft(); if (!S.xres && (S.libs.length || S.prjs.length)) runCheck(); else renderXBody(); }
  if (v === '3d') { init3d(); render3dSide(); show3dForCur(); }
  if (v === 'ed') refresh();
}

/* ---------- кросс-проверка ---------- */
function renderXLeft() {
  const P = $('#xLeft'); const e = S.libs.filter(x => x.lib.kind === 'e'), l = S.libs.filter(x => x.lib.kind === 'l');
  const steps = FSX.list(/\.(step|stp)$/i).length;
  P.innerHTML = `<h3>Базы</h3><div class="muted" style="font-size:12px">Компонентов (.elixml): ${e.length}, корпусов (.libxml): ${l.length}. STEP в подключённых папках: ${steps}.</div>
    <div class="plist">${S.libs.map(E => `<div class="it"><span class="tag ${E.lib.kind}">${E.lib.kind === 'e' ? 'ELI' : 'LIB'}</span><span class="n" title="${esc(E.win || E.name)}">${entryDirty(E) ? '● ' : ''}${esc(E.name)}</span><span class="muted">${E.lib.rows.length}</span></div>`).join('') || '<p class="muted">Нет загруженных баз. «Папки…» → подключите папку DipTrace.</p>'}</div>
    ${S.oldLibFiles && S.oldLibFiles.length ? `<details style="margin-top:6px"><summary>Старые .eli/.lib в папке баз: ${S.oldLibFiles.length}</summary>${S.oldLibFiles.map(x => `<div class="muted" style="font-size:12px">${esc(x)}${S.libs.some(E => FSX.stem(E.name).toLowerCase() === FSX.stem(x).toLowerCase()) ? ' — есть XML' : ' — <span class="warn">нет XML-версии</span>'}</div>`).join('')}</details>` : ''}
    <div class="row"><button class="small" data-a="reload">Перечитать папку баз</button></div>
    <h3>Схемы и платы</h3>
    <div class="plist">${S.prjs.map(X => `<div class="it"><span class="tag ${X.prj.kind}">${X.prj.kind === 'sch' ? 'SCH' : 'PCB'}</span><span class="n" title="${esc(X.win || X.name)}">${X.dirty ? '● ' : ''}${esc(X.name)} <span class="muted">· ${X.prj.items.length}</span></span><span><button class="small" data-fp="${X.id}" title="Исправить устаревшие пути .eli/.lib">пути</button><button class="small" data-rm="${X.id}" title="Убрать из списка">×</button></span></div>`).join('') || '<p class="muted">Добавьте один или несколько проектов .dchxml / .dipxml.</p>'}</div>
    <div class="row"><button class="small" data-a="addp">Добавить файлы…</button><button class="small" data-a="fromroots">Из подключённых папок…</button></div>
    ${S.prjPending && S.prjPending.length ? `<p class="warn" style="font-size:12px">Ждут подтверждения доступа: ${S.prjPending.map(x => esc(x.name)).join(', ')}</p>` : ''}
    <div class="row" style="margin-top:14px"><button class="pri" data-a="run">Проверить</button><span class="muted" id="xTime"></span></div>
    <p class="muted" style="font-size:12px">Цепочка: файл STEP по Path/Var ↔ корпус .libxml ↔ корпус внутри .elixml ↔ компонент .elixml ↔ компоненты схем (LibPath, BaseName/Name, кэш корпуса и 3D) ↔ платы (сверка со схемой по UpdateId).</p>`;
}
$('#xLeft').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'run') runCheck();
  if (b.dataset.a === 'addp') { await addProjectsPicker(); }
  if (b.dataset.a === 'fromroots') await projectsFromRoots();
  if (b.dataset.a === 'reload') { await scanAll(true); renderXLeft(); }
  if (b.dataset.rm) { S.prjs = S.prjs.filter(x => x.id !== b.dataset.rm); persistProjects(); renderXLeft(); if (S.xres) runCheck(); }
  if (b.dataset.fp) { const X = S.prjs.find(x => x.id === b.dataset.fp); if (X) fixPathsDialog(X, 'prj'); }
});
function runCheck() {
  const t0 = performance.now();
  S.xres = XR.run(S.libs.map(E => ({ lib: E.lib, name: E.name, E })), S.prjs.map(X => ({ prj: X.prj, name: X.name, X })));
  const ne = S.xres.issues.filter(i => i.lvl === 'err').length, nw = S.xres.issues.filter(i => i.lvl === 'warn').length;
  $('#xBadge').innerHTML = ne ? `<span class="badge">${ne}</span>` : nw ? `<span class="badge w">${nw}</span>` : '';
  const tt = $('#xTime'); if (tt) tt.textContent = `${((performance.now() - t0) / 1000).toFixed(2)} с`;
  renderXBody();
}
S.xf = { mode: 'iss', lv: { err: true, warn: true, info: false }, cat: '', q: '' };
function renderXBody() {
  const T = $('#xTb'), B = $('#xBody'), R = S.xres; if (!R) { T.innerHTML = ''; return; }
  const f = S.xf; const cats = [...new Set(R.issues.map(i => i.cat))].sort();
  const cnt = l => R.issues.filter(i => i.lvl === l).length;
  T.innerHTML = `<select id="xMode"><option value="iss" ${f.mode === 'iss' ? 'selected' : ''}>Замечания (${R.issues.length})</option><option value="mx" ${f.mode === 'mx' ? 'selected' : ''}>Матрица компонентов (${R.matrix.length})</option><option value="un" ${f.mode === 'un' ? 'selected' : ''}>Модели без ссылок (${R.unused.length})</option></select>
    ${f.mode === 'iss' ? `<label><input type="checkbox" data-lv="err" ${f.lv.err ? 'checked' : ''}> <span class="l err">ошибки</span> ${cnt('err')}</label><label><input type="checkbox" data-lv="warn" ${f.lv.warn ? 'checked' : ''}> <span class="l warn">внимание</span> ${cnt('warn')}</label><label><input type="checkbox" data-lv="info" ${f.lv.info ? 'checked' : ''}> инфо ${cnt('info')}</label>
    <select id="xCat"><option value="">все разделы</option>${cats.map(c => `<option ${c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    <input type="search" id="xQ" placeholder="поиск" value="${esc(f.q)}" style="width:200px"><span class="grow"></span><button class="small" id="xCsv">CSV</button>`;
  const q = f.q.trim().toLowerCase();
  if (f.mode === 'iss') {
    const list = R.issues.filter(i => f.lv[i.lvl] && (!f.cat || i.cat === f.cat) && (!q || (i.where + ' ' + i.obj + ' ' + i.msg).toLowerCase().includes(q)));
    S.xlist = list;
    B.innerHTML = list.length ? `<table class="t"><tr><th>Уровень</th><th>Раздел</th><th>Файл</th><th>Объект</th><th>Сообщение</th><th>Действие</th></tr>${list.slice(0, 3000).map((i, k) => `<tr><td class="nw"><span class="l ${i.lvl}">${{ err: 'ошибка', warn: 'внимание', info: 'инфо' }[i.lvl]}</span></td><td class="nw">${esc(i.cat)}</td><td>${esc(i.where)}</td><td>${esc(i.obj)}</td><td>${esc(i.msg)}</td><td class="nw">${fixBtns(i, k)}</td></tr>`).join('')}</table>${list.length > 3000 ? `<p class="muted">Показаны первые 3000 из ${list.length}</p>` : ''}` : '<div class="empty"><p class="ok">Замечаний с выбранными фильтрами нет.</p></div>';
  } else if (f.mode === 'mx') {
    const list = R.matrix.filter(m => !q || [m.comp, m.lib, m.pat, m.libxml, m.m3, m.sch.join(' '), m.pcb.join(' ')].join(' ').toLowerCase().includes(q));
    S.xlist = list;
    const stc = { ok: '<span class="ok">✓</span>', miss: '<span class="err">✗ нет</span>', unk: '<span class="warn">?</span>', none: '<span class="muted">—</span>', gen: '<span class="muted">генер.</span>' };
    B.innerHTML = `<table class="t"><tr><th>Компонент</th><th>.elixml</th><th>Корпус</th><th>.libxml</th><th>3D</th><th>Файл</th><th>Схемы</th><th>Платы</th><th>Замечания</th></tr>${list.slice(0, 5000).map((m, k) => `<tr data-mx="${k}" style="cursor:pointer"><td>${esc(m.comp)}</td><td class="nw">${esc(m.lib)}</td><td>${esc(m.pat)}</td><td class="nw">${esc(m.libxml) || (m.pat ? '<span class="muted">—</span>' : '')}</td><td>${esc(m.m3)}</td><td class="nw">${stc[m.m3st] || ''}</td><td title="${esc(m.sch.join(', '))}">${m.sch.length ? m.sch.length + ': ' + esc(m.sch.slice(0, 4).map(x => x.split('@')[0]).join(', ')) + (m.sch.length > 4 ? '…' : '') : ''}</td><td title="${esc(m.pcb.join(', '))}">${m.pcb.length ? m.pcb.length + ': ' + esc(m.pcb.slice(0, 4).map(x => x.split('@')[0]).join(', ')) + (m.pcb.length > 4 ? '…' : '') : ''}</td><td class="warn">${esc(m.notes.join('; '))}</td></tr>`).join('')}</table>`;
  } else {
    const list = R.unused.filter(m => !q || m.win.toLowerCase().includes(q)); S.xlist = list;
    B.innerHTML = `<p class="muted" style="padding:0 12px">Файлы STEP в подключённых папках, на которые не ссылается ни одна загруженная база или проект.</p><table class="t"><tr><th>Файл</th><th></th></tr>${list.slice(0, 5000).map((m, k) => `<tr><td>${esc(m.win)}</td><td class="nw"><button class="small" data-pv="${k}">Просмотр</button></td></tr>`).join('')}</table>`;
  }
}
function fixBtns(i, k) {
  const f = i.fix; if (!f) return '';
  const o = '<button class="small" data-fx="' + k + '"';
  if (f.t === 'attach') return o + ' data-k="attach">Прикрепить STEP…</button>' + o + ' data-k="open">Открыть</button>';
  if (f.t === 'relink') return o + ' data-k="relink" title="' + esc(f.to.win) + '">Указать найденный</button>' + o + ' data-k="attach">Другой…</button>';
  if (f.t === 'syncpath') return o + ' data-k="syncpath" title="Записать в Path путь, вычисленный из Var">Path по Var</button>';
  if (f.t === 'sync3d') return o + ' data-k="toE" title="Скопировать 3D из .libxml в корпус внутри .elixml">3D ← .libxml</button>' + o + ' data-k="toL" title="Скопировать 3D из .elixml в .libxml">3D → .libxml</button>' + o + ' data-k="open">Открыть</button>';
  if (f.t === 'paths') return o + ' data-k="paths">Исправить пути…</button>';
  return '';
}
$('#xTb').addEventListener('change', e => { const t = e.target; if (t.id === 'xMode') S.xf.mode = t.value; if (t.dataset.lv) S.xf.lv[t.dataset.lv] = t.checked; if (t.id === 'xCat') S.xf.cat = t.value; renderXBody(); });
$('#xTb').addEventListener('input', e => { if (e.target.id === 'xQ') { S.xf.q = e.target.value; clearTimeout(S.xqt); S.xqt = setTimeout(() => { renderXBody(); const q = $('#xQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); } });
$('#xTb').addEventListener('click', e => {
  if (e.target.id !== 'xCsv' || !S.xres) return; const f = S.xf; let rows;
  if (f.mode === 'iss') rows = [['Уровень', 'Раздел', 'Файл', 'Объект', 'Сообщение'], ...S.xlist.map(i => [i.lvl, i.cat, i.where, i.obj, i.msg])];
  else if (f.mode === 'mx') rows = [['Компонент', 'Библиотека', 'Корпус', 'libxml', '3D', 'Статус 3D', 'Схемы', 'Платы', 'Замечания'], ...S.xlist.map(m => [m.comp, m.lib, m.pat, m.libxml, m.m3, m.m3st, m.sch.join(', '), m.pcb.join(', '), m.notes.join('; ')])];
  else rows = [['Файл'], ...S.xlist.map(m => [m.win])];
  download(new Blob([XL.toCSV(rows)], { type: 'text/csv' }), 'кросс-проверка_' + f.mode + '_' + stamp() + '.csv');
});
function entryOfLib(lib) { return S.libs.find(E => E.lib === lib); }
function recOfPat(E, p) { return E.lib.rows.find(r => r.p === p) || null; }
function openRec(E, p, view) { const r = recOfPat(E, p); selectLib(E, r && r.id); setView(view || 'ed'); }
function copy3d(from, to, toLib) {
  return op('Синхронизация 3D', tx => { const rec = toLib.rows.find(r => r.p === to) || to; DT.touch(tx, rec); for (const k of ['M3Type', 'M3Path', 'M3Var', 'M3Rot', 'M3Off', 'M3Zoom']) DT.setVal(rec, k, from.d[k] || ''); return true; }, {}, toLib);
}
$('#xBody').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-mx]'); if (tr && !e.target.closest('button')) { const m = S.xlist[+tr.dataset.mx]; const E = entryOfLib(m.L.lib); if (E) { selectLib(E, m.r.id); setView('ed'); } return; }
  const pv = e.target.closest('button[data-pv]'); if (pv) { const m = S.xlist[+pv.dataset.pv]; setView('3d'); previewEntry(m.entry, m.win); return; }
  const b = e.target.closest('button[data-fx]'); if (!b) return; const i = S.xlist[+b.dataset.fx], f = i.fix, k = b.dataset.k;
  if (k === 'paths') { if (f.kind === 'prj') fixPathsDialog(f.target.X, 'prj'); else fixPathsDialog(f.target.E || entryOfLib(f.target.lib), 'lib'); return; }
  if (k === 'open' || k === 'attach') { const L = f.L || f.a.L; const p = f.p || f.a.p; const E = entryOfLib(L.lib); if (E) { openRec(E, p, k === 'attach' ? '3d' : 'ed'); if (k === 'attach') S.m3q = FSX.stem(p.d.M3Var || p.d.M3Path || p.d.Pattern); render3dSide(); } return; }
  if (k === 'relink') { const E = entryOfLib(f.L.lib); const rec = recOfPat(E, f.p) || f.p; op('Путь 3D по найденному файлу', tx => { DT.touch(tx, rec); DT.setVal(rec, 'M3Path', f.to.win); DT.setVal(rec, 'M3Var', FSX.winToVar(f.to.win, '%my3dmodels%')); }, {}, E.lib); toast('Путь исправлен в ' + E.name + ' — сохраните библиотеку'); runCheck(); return; }
  if (k === 'syncpath') { const E = entryOfLib(f.L.lib); const rec = recOfPat(E, f.p) || f.p; op('Path по Var', tx => { DT.touch(tx, rec); DT.setVal(rec, 'M3Path', f.win); }, {}, E.lib); runCheck(); return; }
  if (k === 'toE' || k === 'toL') { const [src, dst] = k === 'toE' ? [f.b, f.a] : [f.a, f.b]; copy3d(src.p, dst.p, dst.L.lib); toast('3D скопирован в ' + dst.L.name + ' — сохраните библиотеку'); runCheck(); return; }
});

/* ---------- 3D ---------- */
let V3 = null;
function init3d() {
  if (V3) return; try { V3 = new S3.Viewer($('#cv3d')); } catch (er) { $('#cvinfo').textContent = er.message; return; }
  $('.cvbar').addEventListener('click', e => { const b = e.target.closest('button[data-vw]'); if (!b) return; b.dataset.vw === 'fit' ? V3.fit() : V3.view(b.dataset.vw); });
  $('#c3pads').onchange = e => { V3.showPads = e.target.checked; V3.draw(); };
  $('#c3model').onchange = e => { V3.showModel = e.target.checked; V3.draw(); };
  $('#b3png').onclick = () => { V3.draw(); $('#cv3d').toBlob(b => download(b, 'model_' + stamp() + '.png')); };
}
const xyzArr = s => String(s || '').split(';').map(Number);
function curXf(p) { return { rot: xyzArr(p.d.M3Rot || '0;0;0'), off: xyzArr(p.d.M3Off || '0;0;0'), zoom: xyzArr(p.d.M3Zoom || '1;1;1') }; }
let load3dSeq = 0;
async function showModel(entry, key, xf) {
  const my = ++load3dSeq; $('#cvinfo').innerHTML = `<span class="spin"></span> загрузка ${esc(FSX.base(key))}… (первый запуск OpenCascade — несколько секунд)`;
  try { const bytes = entry instanceof File ? new Uint8Array(await entry.arrayBuffer()) : await FSX.readBytes(entry); const t0 = performance.now(); const meshes = await S3.load(bytes, key); if (my !== load3dSeq) return;
    V3.setMeshes(meshes); if (xf) V3.setTransform(xf); V3.fit(); const tri = meshes.reduce((s, m) => s + m.idx.length / 3, 0);
    $('#cvinfo').textContent = `${FSX.base(key)} · ${meshes.length} тел · ${tri} треугольников · ${((performance.now() - t0) / 1000).toFixed(1)} с`;
  } catch (er) { if (my !== load3dSeq) return; V3.clearModel(); V3.draw(); $('#cvinfo').innerHTML = `<span class="err">${esc(er.message)}</span>`; }
}
function show3dForCur() {
  if (!V3 || S.viewName !== '3d') return; const c = S.cur; S.preview = null;
  if (!c || !c.p) { V3.clearModel(); V3.setBoard([], null); $('#cvinfo').textContent = c ? 'Корпус не привязан' : 'Выберите запись в редакторе'; return; }
  const p = c.p; let pads = []; try { pads = S3.padsOf(S.lib, p); } catch (e) { }
  V3.setBoard(pads, { w: +XT.attr(p.node, 'Width') || 0, h: +XT.attr(p.node, 'Height') || 0 }); V3.setTransform(curXf(p));
  if (p.d.M3Type !== 'File') { V3.clearModel(); V3.fit(); $('#cvinfo').textContent = `${p.d.Pattern}: ${p.d.M3Type ? '3D генерируется DipTrace (' + p.d.M3Type + ') — просмотр недоступен' : '3D-модель не задана'}`; return; }
  const s = FSX.resolve(p.d.M3Path, p.d.M3Var);
  if (s.st !== 'ok') { V3.clearModel(); V3.fit(); $('#cvinfo').innerHTML = `<span class="err">${esc(p.d.Pattern)}: ${esc(STLBL[s.st] || '')}</span> ${esc(p.d.M3Var || p.d.M3Path)}`; return; }
  showModel(s.entry, s.win, curXf(p));
}
async function previewEntry(entry, win) { init3d(); S.preview = { entry, win }; await showModel(entry, win, S.cur && S.cur.p ? curXf(S.cur.p) : null); render3dSide(); }
async function previewFile(file, name) { init3d(); S.preview = { file, win: name }; V3.setBoard([], null); await showModel(file, name, null); render3dSide(); }
function render3dSide() {
  const P = $('#side3'); if (!P) return; const c = S.cur, p = c && c.p;
  const models = FSX.list(/\.(step|stp)$/i).filter(m => !/\\_backup\\/i.test(m.win));
  const q = (S.m3q || '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const found = words.length ? models.filter(m => words.every(w => m.win.toLowerCase().includes(w))) : models;
  let h = '';
  if (!S.lib) h += '<p class="muted">Загрузите библиотеку.</p>';
  else if (!p) h += `<p class="muted">${c ? 'У записи нет корпуса.' : 'Выберите запись в редакторе.'}</p>`;
  else {
    const s = DT.getVal(c, 'M3Status');
    h += `<h3>${esc(S.E.name)}</h3><div class="f"><label>Запись</label><div class="v">#${c.id} ${esc(rowName(c))}</div><label>Корпус</label><div class="v">${esc(p.d.Pattern)}${isE() && p.users > 1 ? ` <span class="warn">(общий для ${p.users} компонентов)</span>` : ''}</div>
      <label>Источник 3D</label><select data-m3="M3Type">${['', 'File', 'IPC-7351', 'Outline'].map(x => `<option value="${x}" ${x === p.d.M3Type ? 'selected' : ''}>${x || '— нет —'}</option>`).join('')}</select>
      <label>Var</label><input data-m3="M3Var" value="${esc(p.d.M3Var)}" ${DT.isChanged(c, 'M3Var') ? 'style="background:var(--chg)"' : ''}>
      <label>Path</label><input data-m3="M3Path" value="${esc(p.d.M3Path)}" ${DT.isChanged(c, 'M3Path') ? 'style="background:var(--chg)"' : ''}>
      <label>Файл</label><div class="v ${s[0] === '✓' ? 'ok' : s[0] === '✗' ? 'err' : 'warn'}">${esc(s)}</div></div>
      <div class="xyz"><span class="muted">поворот, °</span>${xyzArr(p.d.M3Rot || '0;0;0').map((v, i) => `<input type="number" step="90" data-x="M3Rot" data-j="${i}" value="${v}">`).join('')}</div>
      <div class="xyz"><span class="muted">смещение</span>${xyzArr(p.d.M3Off || '0;0;0').map((v, i) => `<input type="number" step="0.05" data-x="M3Off" data-j="${i}" value="${v}">`).join('')}</div>
      <div class="xyz"><span class="muted">масштаб</span>${xyzArr(p.d.M3Zoom || '1;1;1').map((v, i) => `<input type="number" step="0.1" data-x="M3Zoom" data-j="${i}" value="${v}">`).join('')}</div>
      <div class="row"><button class="small" data-a="rz">Z +90°</button><button class="small" data-a="rx">X +90°</button><button class="small" data-a="r0">Сбросить поворот и смещение</button><button class="small" data-a="reset" ${['M3Type', 'M3Var', 'M3Path', 'M3Rot', 'M3Off', 'M3Zoom'].some(k => DT.isChanged(c, k)) ? '' : 'disabled'}>Вернуть исходные</button></div>`;
  }
  h += `<h3>Модели в подключённых папках (${models.length})</h3>
    <input type="search" id="m3q" placeholder="поиск по имени и пути, через пробел" value="${esc(S.m3q || '')}" style="width:100%">
    <div class="mlist" id="mlist">${found.slice(0, 300).map((m, i) => `<div data-mi="${i}" class="${S.preview && S.preview.win === m.win ? 'on' : ''}" title="${esc(m.win)}">${esc(m.rel)}</div>`).join('') || '<div class="muted">Ничего не найдено. Подключите папку моделей: «Папки…».</div>'}</div>
    ${found.length > 300 ? `<div class="muted" style="font-size:12px">Показаны 300 из ${found.length} — уточните поиск</div>` : ''}
    <div class="row">${p ? `<button class="pri small" data-a="attach" ${S.preview && S.preview.entry ? '' : 'disabled'} title="Прикрепить просматриваемую модель к корпусу">Прикрепить выбранную</button><button class="small" data-a="other" title="Выбрать другой STEP; файл вне папки моделей будет скопирован в неё">Другой файл…</button>` : ''}<button class="small" data-a="view">Только просмотреть файл…</button>${S.preview ? '<button class="small" data-a="back">К модели записи</button>' : ''}</div>
    <p class="muted" style="font-size:12px">Просмотр: левая кнопка — вращение, правая или Shift — сдвиг, колесо — масштаб, двойной щелчок — вписать. Площадки корпуса показаны на плоскости платы; поворот/смещение/масштаб применяются как в DipTrace (масштаб → X → Y → Z → смещение), результат стоит проверить в 3D-окне DipTrace. VRML (.wrl) не отображается.</p>`;
  P.innerHTML = h; S.m3found = found;
}
$('#side3').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'm3q') { S.m3q = t.value; clearTimeout(S.m3t); S.m3t = setTimeout(() => { render3dSide(); const q = $('#m3q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200); return; }
  if (t.dataset.x && S.cur && S.cur.p && V3) { const xf = curXf(S.cur.p); const k = { M3Rot: 'rot', M3Off: 'off', M3Zoom: 'zoom' }[t.dataset.x]; xf[k][+t.dataset.j] = +t.value || 0; V3.setTransform(xf); }
});
$('#side3').addEventListener('change', e => {
  const t = e.target, c = S.cur; if (!c || !c.p) return;
  if (t.dataset.m3) { setCells([[c, t.dataset.m3, t.value]], '3D: ' + t.dataset.m3); show3dForCur(); render3dSide(); return; }
  if (t.dataset.x) { const a = xyzArr(c.p.d[t.dataset.x] || (t.dataset.x === 'M3Zoom' ? '1;1;1' : '0;0;0')); a[+t.dataset.j] = +t.value || 0; setCells([[c, t.dataset.x, a.join(';')]], '3D: ' + t.dataset.x); render3dSide(); }
});
$('#side3').addEventListener('click', async e => {
  const it = e.target.closest('[data-mi]'); if (it) { const m = S.m3found[+it.dataset.mi]; previewEntry(m.entry, m.win); return; }
  const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a, c = S.cur, p = c && c.p;
  if (a === 'view') { if (window.showOpenFilePicker) { try { const [h] = await window.showOpenFilePicker({ id: 'dtx-step', types: [{ description: 'STEP', accept: { 'application/step': ['.step', '.stp'] } }] }); const f = await h.getFile(); previewFile(f, f.name); } catch (er) { } } else { S._stepCb = f => previewFile(f, f.name); $('#fStep').click(); } return; }
  if (a === 'back') { S.preview = null; show3dForCur(); render3dSide(); return; }
  if (!p) return;
  if (a === 'rz' || a === 'rx') { const r = xyzArr(p.d.M3Rot || '0;0;0'); const j = a === 'rz' ? 2 : 0; r[j] = ((r[j] + 90) % 360 + 360) % 360; setCells([[c, 'M3Rot', r.join(';')]], '3D: поворот'); show3dForCur(); render3dSide(); return; }
  if (a === 'r0') { op('3D: сброс поворота', tx => { DT.touch(tx, c); DT.setVal(c, 'M3Rot', '0;0;0'); DT.setVal(c, 'M3Off', '0;0;0'); DT.setVal(c, 'M3Zoom', '1;1;1'); }); show3dForCur(); render3dSide(); return; }
  if (a === 'reset') { op('3D: исходные значения', tx => { DT.touch(tx, c); for (const k of ['M3Type', 'M3Var', 'M3Path', 'M3Rot', 'M3Off', 'M3Zoom']) DT.setVal(c, k, p.o.d[k] || ''); }); show3dForCur(); render3dSide(); return; }
  if (a === 'attach' && S.preview && S.preview.entry) { attachWin(c, S.preview.win); return; }
  if (a === 'other') { await attachOther(c); return; }
});
$('#fStep').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f && S._stepCb) S._stepCb(f); });
function attachWin(c, win) {
  const p = c.p; const v = FSX.winToVar(win, '%my3dmodels%');
  const first = p.d.M3Type !== 'File' || !(p.d.M3Path || p.d.M3Var);
  op('Прикрепить 3D: ' + FSX.base(win), tx => { DT.touch(tx, c); DT.setVal(c, 'M3Type', 'File'); DT.setVal(c, 'M3Path', win); DT.setVal(c, 'M3Var', v); if (first) { if (!p.d.M3Rot) DT.setVal(c, 'M3Rot', '0;0;0'); if (!p.d.M3Off) DT.setVal(c, 'M3Off', '0;0;0'); if (!p.d.M3Zoom) DT.setVal(c, 'M3Zoom', '1;1;1'); } });
  S.preview = null; toast(`Прикреплено: ${v}` + (isE() && p.users > 1 ? ` (корпус общий для ${p.users} компонентов)` : '') + '. Сохраните библиотеку.', 4500);
  show3dForCur(); render3dSide();
}
async function attachOther(c) {
  if (!window.showOpenFilePicker) { toast('Нужен Chrome / Edge / Comet с доступом к файлам'); return; }
  const mr = FSX.rootFor(FSX.st.settings.models);
  let h; try { [h] = await window.showOpenFilePicker({ id: 'dtx-step', startIn: mr && mr.handle ? mr.handle : 'documents', types: [{ description: 'STEP', accept: { 'application/step': ['.step', '.stp'] } }] }); } catch (er) { return; }
  // файл уже внутри подключённой папки?
  for (const r of FSX.st.roots) if (r.handle && r.handle.resolve) { try { const parts = await r.handle.resolve(h); if (parts) { const rel = parts.join('\\'); if (!r.files.has(rel.toLowerCase())) r.files.set(rel.toLowerCase(), { rel, handle: h }); attachWin(c, FSX.join(r.win, rel)); return; } } catch (e) { } }
  if (!mr || !mr.handle || mr.perm !== 'granted') { toast('Папка моделей ' + FSX.st.settings.models + ' не подключена с правом записи — подключите её в «Папки…»', 5000); return; }
  const f = await h.getFile();
  const relModels = FSX.norm(FSX.st.settings.models).slice(FSX.norm(mr.win).length).replace(/^\\/, '');
  const curDir = c.p.d.M3Var && /^%my3dmodels%\\/i.test(c.p.d.M3Var) ? c.p.d.M3Var.replace(/^%my3dmodels%\\/i, '').split('\\').slice(0, -1).join('\\') : '';
  const b = [{ t: 'Отмена', v: 0 }, { t: 'Скопировать и прикрепить', v: 1, pri: true }]; b.onOpen = bg => S._ao = bg;
  if (await modal('Копировать модель в папку моделей', `<p>Файл <b>${esc(f.name)}</b> находится вне подключённых папок. Он будет скопирован в папку моделей:</p><div class="f"><label>Подпапка в models3d</label><input id="aoDir" value="${esc(curDir || 'User')}"><label>Имя файла</label><input id="aoName" value="${esc(f.name)}"></div>`, b) !== 1) return;
  const dir = FSX.norm(S._ao.querySelector('#aoDir').value.trim()), name = S._ao.querySelector('#aoName').value.trim() || f.name;
  const rel = [relModels, dir, name].filter(Boolean).join('\\');
  if (mr.files.has(rel.toLowerCase()) && !confirm('Файл ' + rel + ' уже есть. Заменить?')) return;
  try { await FSX.writeRel(mr, rel, f); } catch (er) { toast('Не удалось скопировать: ' + er.message, 5000); return; }
  attachWin(c, FSX.join(mr.win, rel));
}
(() => { for (const [sp, varName, el] of [['#split', '--side', '#main'], ['#split3', null, '#v-3d']]) { const s = $(sp); s.addEventListener('mousedown', e => { e.preventDefault(); const mv = ev => { const w = Math.min(Math.max(280, window.innerWidth - ev.clientX), window.innerWidth - 300); if (varName) $(el).style.setProperty(varName, w + 'px'); else $(el).style.gridTemplateColumns = `1fr 6px ${w}px`; }; const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); renderBody(); V3 && V3.draw(); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); }); } })();
window.addEventListener('resize', () => renderBody());

/* ---------- прочее ---------- */
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
$('#bTheme').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; LS.set('theme', t); V3 && V3.draw(); };
$('#bHelp').onclick = () => modal('Справка', `
<h3>Начало работы</h3><ol>
<li><b>Папки…</b> → «Подключить папку DipTrace…» → выберите <code>${esc(FSX.DEF.base)}</code>, подтвердите путь Windows и разрешите запись. Базы из <code>lib\\</code> (.elixml, .libxml) загрузятся автоматически, <code>models3d\\</code> проиндексируется. Доступ запоминается; после перезапуска браузер может попросить подтвердить его одной кнопкой.</li>
<li>Стандартные модели <code>C:\\Program Files\\DipTrace\\models3d</code> — «Добавить папку только для чтения…» (Chrome не даёт прямой доступ к Program Files; такую папку нужно добавлять в каждом сеансе).</li>
<li>Выберите библиотеку в списке в заголовке, правьте в таблице или на боковой панели. <b>Сохранить</b> (<span class="kbd">Ctrl+S</span>) пишет файл на место, исходная версия копируется в <code>lib\\_backup\\имя.ГГГГММДД_ччммсс.elixml</code>. <b>Сохранить всё</b> (<span class="kbd">Ctrl+Shift+S</span>) — все изменённые базы и проекты. Если DipTrace держит библиотеку открытой, закройте её в редакторе компонентов перед записью и переоткройте после.</li></ol>
<h3>Что редактируется</h3><p>.elixml — служебные поля компонента, поставщик, подпапка, корпус (имя, описание, альтернативные имена, производитель), 3D-модель, пользовательские поля компонента (UF) и корпуса (PUF). .libxml — те же поля корпусов. Символы, выводы, площадки, графика переносятся байт в байт; файл без правок остаётся идентичным исходному. Корпус в .elixml может быть общим для нескольких компонентов — правка корпуса и 3D действует на все.</p>
<h3>Кросс-проверка</h3><p>Сверяет цепочку: файл STEP по Path/Var → корпуса .libxml → корпуса внутри .elixml (3D, число площадок) → компоненты .elixml → схемы (LibPath, BaseName/Name, корпус и 3D в кэше проекта) → платы (сверка со схемой по UpdateId: имя, Value, корпус). Для расхождений есть действия: указать найденный по имени файл, прикрепить STEP, скопировать 3D между .libxml и .elixml, Path по Var. Ссылки на устаревшие <code>.eli</code>/<code>.lib</code> в базах и проектах исправляются на <code>.elixml</code>/<code>.libxml</code> (только теги Path/Var, с резервной копией). Список проектов запоминается.</p>
<h3>3D</h3><p>Вкладка «3D-просмотр»: модель текущей записи с площадками корпуса, поиск по всем STEP в подключённых папках, просмотр и «Прикрепить выбранную», «Другой файл…» (файл вне папки моделей копируется в <code>models3d\\подпапка</code>). Путь записывается в Path полностью и в Var — через переменную (<code>%my3dmodels%\\…</code>). Поворот/смещение/масштаб правятся с живым просмотром. Отображение — через OpenCascade (occt-import-js, WebAssembly), встроено в файл и работает без интернета.</p>
<h3>Таблица</h3><p>Выделение мышью или Shift+стрелки, <span class="kbd">Enter</span>/<span class="kbd">F2</span> или ввод символа — правка, <span class="kbd">Ctrl+C</span>/<span class="kbd">Ctrl+V</span> — обмен блоками с Excel, <span class="kbd">Ctrl+D</span> — заполнить вниз, <span class="kbd">Del</span> — очистить, <span class="kbd">Ctrl+Z</span>/<span class="kbd">Ctrl+Y</span> — отмена/повтор. Фильтры: <code>текст</code>, <code>!текст</code>, <code>==текст</code>, <code>=</code> пусто, <code>*</code> не пусто, <code>?</code> поля нет, <code>/regex/</code>. Фильтр строк «3D: нет файла» показывает записи с отсутствующей моделью.</p>
<h3>Ограничения</h3><p>Поле SubFolderIndex DipTrace читает, но сам при сохранении не пишет — подпапки сохраняются как в исходном файле. Категории копируются от донора. Кэш проекта не правится — после исправления библиотек обновите компоненты из библиотек в DipTrace. Для записи в папки нужен Chrome, Edge или Comet.</p>`, [{ t: 'Закрыть' }], 'wide');

/* ---------- запуск ---------- */
(async () => {
  renderEmpty(); libsChanged();
  if (FSX.supported) {
    await FSX.restore();
    await restoreProjects(false);
    banner();
    if (FSX.st.roots.some(r => r.perm === 'granted' || r.perm === 'read')) await scanAll();
  }
  libsChanged();
})();

/* ---------- вкладка «3D» боковой панели редактора ---------- */
function renderM3Pane() {
  const P = $('#p-m3'), c = S.cur, p = c && c.p;
  if (!c) { P.innerHTML = '<p class="muted">Выберите запись.</p>'; return; }
  if (!p) { P.innerHTML = '<p class="muted">У записи нет корпуса — 3D-модель задаётся в корпусе.</p>'; return; }
  const s = DT.getVal(c, 'M3Status');
  const alt = p.d.M3Type === 'File' && s[0] === '✗' ? FSX.byName(p.d.M3Var || p.d.M3Path, /\.(step|stp)$/i).slice(0, 5) : [];
  const same = isE() ? S.lib.rows.filter(r => r.p === p && r !== c && r.status !== 'del') : [];
  P.innerHTML = `<div class="f"><label>Корпус</label><div class="v">${esc(p.d.Pattern)}</div><label>Источник</label><div class="v">${esc(p.d.M3Type || '— нет —')}</div><label>Var</label><div class="v">${esc(p.d.M3Var)}</div><label>Path</label><div class="v">${esc(p.d.M3Path)}</div><label>Файл</label><div class="v ${s[0] === '✓' ? 'ok' : s[0] === '✗' ? 'err' : 'warn'}">${esc(s)}</div><label>Поворот</label><div class="v">${esc(p.d.M3Rot)}</div><label>Смещение</label><div class="v">${esc(p.d.M3Off)}</div><label>Масштаб</label><div class="v">${esc(p.d.M3Zoom)}</div></div>
  ${alt.length ? `<p class="warn">Найдено по имени файла:</p>${alt.map((a, i) => `<div class="row"><button class="small" data-alt="${i}">Указать</button> <span style="font-size:12px">${esc(a.win)}</span></div>`).join('')}` : ''}
  ${same.length ? `<p class="muted">Этот корпус используют также: ${same.slice(0, 10).map(r => esc(r.d.Name)).join(', ')}${same.length > 10 ? '…' : ''} — изменение 3D действует на все.</p>` : ''}
  <div class="row"><button class="pri small" data-a="open3d">3D-просмотр и выбор модели</button></div>`;
  P.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a === 'open3d') { setView('3d'); return; } if (b.dataset.alt) { attachWin(c, alt[+b.dataset.alt].win); renderSide(); } };
}
