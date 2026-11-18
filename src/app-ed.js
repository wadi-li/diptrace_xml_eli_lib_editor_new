'use strict';
/* ===== Редактор: таблица, боковая панель, массовая правка, шаблон полей, экспорт/импорт таблиц ===== */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get(k, d) { try { const v = localStorage.getItem('dtx.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('dtx.' + k, JSON.stringify(v)); } catch (e) { } } };
const GROUPS = { svc: 'Служебные', sup: 'Поставщик', pat: 'Корпус', m3: '3D-модель', uf: 'Поля компонента', puf: 'Поля корпуса' };
const GB = { svc: 'S', sup: 'SUP', pat: 'PAT', m3: '3D', uf: 'UF', puf: 'PUF' };
const S = { libs: [], prjs: [], E: null, lib: null, cols: [], allCols: [], view: [], checked: new Set(), filters: {}, search: '', sort: null, cur: null,
  a: { r: 0, c: 0 }, b: { r: 0, c: 0 }, groups: LS.get('groups', { svc: true, sup: false, pat: true, m3: true, uf: true, puf: false }), hidden: new Set(LS.get('hidden', [])),
  widths: LS.get('widths', {}), tpl: LS.get('tpl', null), rowH: 27, tab: 'comp', stats: {}, viewName: 'ed' };
document.documentElement.dataset.theme = LS.get('theme', 'light');

function toast(t, ms = 2800) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), ms); }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function modal(title, html, buttons = [{ t: 'Закрыть' }], cls = '') {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${cls}"><div class="mh">${esc(title)}<button class="small" data-x>×</button></div><div class="mb">${html}</div><div class="mf">${buttons.map((b, i) => `<button data-i="${i}" class="${b.pri ? 'pri' : ''}">${esc(b.t)}</button>`).join('')}</div></div>`;
    const close = v => { bg.remove(); res(v); };
    bg.addEventListener('click', e => { if (e.target === bg || e.target.dataset.x !== undefined) close(null); const i = e.target.dataset.i; if (i !== undefined && e.target.closest('.mf')) close(buttons[+i].v !== undefined ? buttons[+i].v : +i); });
    document.body.appendChild(bg); const f = bg.querySelector('.mf .pri') || bg.querySelector('.mf button'); f && f.focus();
    if (buttons.onOpen) buttons.onOpen(bg);
  });
}
const nameKey = () => S.lib && S.lib.kind === 'l' ? 'Pattern' : 'Name';
const rowName = r => r ? (r.kind === 'pat' ? r.d.Pattern : r.d.Name) : '';
const baseName = () => (S.E ? S.E.name : 'library').replace(/\.[^.]+$/, '');
const stamp = () => FSX.stamp().slice(0, 13);
const isE = () => S.lib && S.lib.kind === 'e';

/* ---------- операции с историей ---------- */
function op(label, fn, opts = {}, lib = S.lib) {
  const tx = DT.begin(lib, label); const r = fn(tx);
  const ok = DT.commit(lib, tx);
  if (ok) { if (lib === S.lib) refresh(opts); else libsChanged(); }
  return r;
}
function undo() { const l = DT.undo(S.lib); if (l) { toast('Отменено: ' + l); refresh({ cols: true }); } }
function redo() { const l = DT.redo(S.lib); if (l) { toast('Повторено: ' + l); refresh({ cols: true }); } }
function defType(key) {
  const n = DT.ufName(key), sc = key.startsWith('UF:') ? 'C' : 'P';
  const t = (S.tpl || []).find(x => x.n === n && x.scope.includes(sc)); if (t) return t.t | 0;
  const s = S.stats[key]; return s ? s.t : 0;
}

/* ---------- столбцы ---------- */
function buildCols() {
  const lib = S.lib; const cols = [];
  cols.push({ key: '#cb', label: '', w: 30, stk: true, sys: true }, { key: '#id', label: 'ID', w: 52, stk: true, sys: true });
  const nk = nameKey();
  const fl = DT.FIELDS.filter(f => DT.fieldAvail(lib, f.key));
  fl.sort((a, b) => (b.key === nk) - (a.key === nk));
  for (const f of fl) cols.push({ key: f.key, label: f.key, title: f.label, g: f.g, ro: !!f.ro, stk: f.key === nk });
  S.stats = {};
  const live = lib.rows.filter(c => c.status !== 'del').length || 1;
  for (const [pre, g] of (isE() ? [['UF:', 'uf'], ['PUF:', 'puf']] : [['PUF:', 'puf']])) {
    const st = DT.ufStats(lib, pre);
    for (const t of S.tpl || []) if (t.scope.includes(pre === 'UF:' ? 'C' : 'P') && !st.some(s => s.n === t.n)) st.push({ n: t.n, count: 0, t: t.t });
    for (const s of st) { S.stats[pre + s.n] = s; cols.push({ key: pre + s.n, label: s.n, title: `${GROUPS[g]}: «${s.n}» — есть у ${s.count} из ${live}`, g, count: s.count }); }
  }
  S.allCols = cols;
  S.cols = cols.filter(c => c.sys || (S.groups[c.g] && !S.hidden.has(c.key)) || c.key === nk);
  let left = 0; for (const c of S.cols) { c.w = c.sys ? c.w : (S.widths[c.key] || (c.key === nk ? 200 : c.g === 'uf' || c.g === 'puf' ? 130 : ['Datasheet', 'PatDescription', 'M3Var', 'M3Path', 'Category', 'PatCategory'].includes(c.key) ? 240 : c.key === 'M3Status' ? 150 : 120)); if (c.stk) { c.left = left; left += c.w; } }
  renderChips();
}
function renderChips() {
  const present = new Set(S.allCols.map(c => c.g).filter(Boolean));
  $('#grpChips').innerHTML = Object.entries(GROUPS).filter(([g]) => present.has(g)).map(([g, t]) => `<span class="chip ${S.groups[g] ? 'on' : ''}" data-g="${g}"><span class="gb ${g}">${GB[g]}</span>${t}</span>`).join('');
}
$('#grpChips').addEventListener('click', e => { const ch = e.target.closest('.chip'); if (!ch) return; S.groups[ch.dataset.g] = !S.groups[ch.dataset.g]; LS.set('groups', S.groups); refresh({ cols: true }); });

/* ---------- фильтрация ---------- */
function cellText(c, key) { if (key === '#id') return String(c.id); const v = DT.getVal(c, key); return v === undefined ? '' : v; }
function matcher(f) {
  f = f.trim(); if (!f) return null;
  if (f === '=') return v => v === '';
  if (f === '*') return v => v !== '';
  if (f === '?') return (v, abs) => abs;
  if (f.startsWith('==')) { const x = f.slice(2).toLowerCase(); return v => v.toLowerCase() === x; }
  if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) { try { const re = new RegExp(f.slice(1, -1), 'i'); return v => re.test(v); } catch (e) { return null; } }
  if (f.startsWith('!')) { const x = f.slice(1).toLowerCase(); return v => !v.toLowerCase().includes(x); }
  const x = f.toLowerCase(); return v => v.toLowerCase().includes(x);
}
function computeView() {
  const lib = S.lib; let rows = lib.rows;
  const st = $('#stFilter').value;
  if (st === 'chg') rows = rows.filter(c => DT.compChanged(c)); else if (st === 'new') rows = rows.filter(c => c.status === 'new'); else if (st === 'del') rows = rows.filter(c => c.status === 'del'); else if (st === 'chk') rows = rows.filter(c => S.checked.has(c));
  else if (st === 'm3bad') rows = rows.filter(c => c.p && String(DT.getVal(c, 'M3Status')).startsWith('✗'));
  else if (st === 'm3none') rows = rows.filter(c => c.p && (!c.p.d.M3Type || (c.p.d.M3Type === 'File' && !c.p.d.M3Path && !c.p.d.M3Var)));
  const fs = Object.entries(S.filters).map(([k, f]) => [k, matcher(f)]).filter(x => x[1] && S.cols.some(c => c.key === x[0]));
  if (fs.length) rows = rows.filter(c => fs.every(([k, m]) => { const v = k === '#id' ? String(c.id) : DT.getVal(c, k); return m(v === undefined ? '' : v, v === undefined); }));
  const q = S.search.trim().toLowerCase();
  if (q) rows = rows.filter(c => S.cols.some(col => !col.sys && cellText(c, col.key).toLowerCase().includes(q)) || String(c.id) === q);
  if (S.sort) { const { key, dir } = S.sort; const coll = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }); rows = [...rows].sort((a, b) => dir * (key === '#id' ? a.id - b.id : coll.compare(cellText(a, key), cellText(b, key)))); }
  S.view = rows;
}

/* ---------- таблица ---------- */
let gridBuilt = false;
function renderEmpty() {
  const gw = $('#gw'); gridBuilt = false;
  const roots = FSX.st.roots;
  gw.innerHTML = `<div class="empty"><div class="drop">
    <p><b>Базы DipTrace XML: .elixml (компоненты) и .libxml (корпуса)</b></p>
    ${FSX.supported ? `<p>Нажмите <b>«Папки…»</b> и подключите папку <code>${esc(FSX.DEF.base)}</code> — библиотеки из <code>lib\\</code> загрузятся автоматически, модели из <code>models3d\\</code> будут проверяться и прикрепляться. Изменения сохраняются прямо в файлы, исходная версия кладётся в <code>_backup\\</code>.</p>` : `<p style="color:var(--warn)">Этот браузер не поддерживает прямую запись в папки (File System Access API). Откройте файл в Chrome, Edge или Comet; здесь доступно открытие файлов и сохранение через загрузку.</p>`}
    <p>Можно также перетащить сюда файлы .elixml/.libxml или проекты .dchxml/.dipxml.</p>
    ${roots.length ? `<p class="muted">Подключено папок: ${roots.length}. ${roots.some(r => r.perm !== 'granted' && r.perm !== 'read') ? 'Нужно подтвердить доступ — кнопка в жёлтой полосе выше.' : ''}</p>` : ''}
    <p class="muted">Всё выполняется локально в браузере. Геометрия символов, корпусов и площадок не изменяется — переписываются только изменённые поля, файл без правок остаётся идентичным байт в байт.</p></div></div>`;
}
function renderGrid() {
  const gw = $('#gw'); if (!S.lib) return;
  const totalW = S.cols.reduce((s, c) => s + c.w, 0);
  const hdr = S.cols.map((c, i) => {
    const cls = [c.stk ? 'stk' : '', c.key === '#cb' ? 'cb' : '', S.sort && S.sort.key === c.key ? (S.sort.dir > 0 ? 'sort-asc' : 'sort-desc') : ''].join(' ');
    const sty = c.stk ? `left:${c.left}px` : '';
    if (c.key === '#cb') return `<th class="${cls}" style="${sty}"><input type="checkbox" id="cbAll" title="Отметить все отфильтрованные"></th>`;
    return `<th class="${cls}" style="${sty}" data-c="${i}" title="${esc(c.title || c.label)}">${c.g ? `<span class="gb ${c.g}">${GB[c.g]}</span>` : ''}${esc(c.label)}${c.sys ? '' : '<span class="rs"></span>'}</th>`;
  }).join('');
  const flt = S.cols.map(c => { const sty = c.stk ? `left:${c.left}px` : ''; if (c.key === '#cb') return `<th class="stk cb" style="${sty}"></th>`; return `<th class="${c.stk ? 'stk' : ''}" style="${sty}"><input type="text" data-f="${esc(c.key)}" value="${esc(S.filters[c.key] || '')}" placeholder="фильтр"></th>`; }).join('');
  gw.innerHTML = `<table class="g" id="tbl" style="width:${totalW}px"><colgroup>${S.cols.map(c => `<col style="width:${c.w}px">`).join('')}</colgroup><thead><tr>${hdr}</tr><tr class="flt">${flt}</tr></thead><tbody id="tb0"></tbody></table>`;
  gridBuilt = true; renderBody();
}
function renderBody() {
  const gw = $('#gw'), tb = $('#tb0'); if (!tb || !S.lib) return;
  const H = S.rowH, n = S.view.length, top = gw.scrollTop, vh = gw.clientHeight;
  const r0 = Math.max(0, Math.floor(top / H) - 8), r1 = Math.min(n, Math.ceil((top + vh) / H) + 8);
  const [ra, rb] = [Math.min(S.a.r, S.b.r), Math.max(S.a.r, S.b.r)], [ca, cb] = [Math.min(S.a.c, S.b.c), Math.max(S.a.c, S.b.c)];
  let h = `<tr style="height:${r0 * H}px"></tr>`;
  for (let r = r0; r < r1; r++) {
    const c = S.view[r];
    h += `<tr class="${c.status === 'new' ? 'new' : c.status === 'del' ? 'del' : ''}${c === S.cur ? ' cur' : ''}" data-r="${r}">`;
    S.cols.forEach((col, ci) => {
      const cls = []; if (col.stk) cls.push('stk');
      const sty = col.stk ? ` style="left:${col.left}px"` : '';
      if (r >= ra && r <= rb && ci >= ca && ci <= cb && !(ra === rb && ca === cb)) cls.push('insel');
      if (r === S.a.r && ci === S.a.c) cls.push('act');
      if (col.key === '#cb') { h += `<td class="cb ${cls.join(' ')}"${sty}><input type="checkbox" ${S.checked.has(c) ? 'checked' : ''} tabindex="-1"></td>`; return; }
      if (col.key === '#id') { cls.push('idc'); h += `<td class="${cls.join(' ')}"${sty} title="${c.status === 'new' ? 'Новая запись, копия #' + c.src : ''}">${c.id}</td>`; return; }
      const v = DT.getVal(c, col.key);
      if (v === undefined) cls.push('abs'); else if (DT.isUF(col.key) && DT.getType(c, col.key) === 1) cls.push('lnk');
      if (col.key === 'M3Status' && v) cls.push(v[0] === '✓' ? 'st-ok' : v[0] === '✗' ? 'st-miss' : 'st-unk');
      if (DT.isRO(col.key, c)) cls.push('ro'); else if (DT.isChanged(c, col.key)) cls.push('chg');
      h += `<td class="${cls.join(' ')}"${sty}>${esc(v)}</td>`;
    });
    h += '</tr>';
  }
  h += `<tr style="height:${(n - r1) * H}px"></tr>`;
  tb.innerHTML = h;
  const all = $('#cbAll'); if (all) { const k = S.view.filter(c => S.checked.has(c)).length; all.checked = k > 0 && k === n; all.indeterminate = k > 0 && k < n; }
  status();
}
function status() {
  const lib = S.lib; if (!lib) { ['#bUndo', '#bRedo'].forEach(s => $(s).disabled = true); return; }
  const chg = lib.rows.filter(c => DT.compChanged(c)).length, nw = lib.rows.filter(c => c.status === 'new').length, dl = lib.rows.filter(c => c.status === 'del').length;
  $('#cnt').textContent = `показано ${S.view.length} из ${lib.rows.length} · отмечено ${S.checked.size}`;
  $('#stChg').textContent = `изменено ${chg} (новых ${nw}, удалённых ${dl})` + (S.E && S.E.forceDirty ? ' · исправлены пути' : '');
  const [ra, rb] = [Math.min(S.a.r, S.b.r), Math.max(S.a.r, S.b.r)], [ca, cb] = [Math.min(S.a.c, S.b.c), Math.max(S.a.c, S.b.c)];
  $('#stSel').textContent = (rb > ra || cb > ca) ? `выделено ${(rb - ra + 1)}×${(cb - ca + 1)}` : '';
  $('#bUndo').disabled = !lib.history.length; $('#bRedo').disabled = !lib.redo.length;
  $('#bUndo').title = lib.history.length ? 'Отменить: ' + lib.history[lib.history.length - 1].label + ' (Ctrl+Z)' : 'Отменить (Ctrl+Z)';
  libsChanged(true);
}
function refresh(o = {}) {
  if (!S.lib) { renderEmpty(); status(); return; }
  if (o.cols || !S.cols.length) buildCols();
  computeView(); clampSel();
  if (o.cols || !gridBuilt) renderGrid(); else renderBody();
  renderSide();
  if (S.viewName === '3d') render3dSide();
}
function clampSel() { const R = Math.max(0, S.view.length - 1), C = Math.max(0, S.cols.length - 1); for (const p of [S.a, S.b]) { p.r = Math.min(Math.max(0, p.r), R); p.c = Math.min(Math.max(0, p.c), C); } }
$('#gw').addEventListener('scroll', () => { if (!edit) requestAnimationFrame(renderBody); });

/* ---------- выделение и мышь ---------- */
let dragging = false;
$('#gw').addEventListener('mousedown', e => {
  const th = e.target.closest('th');
  if (th && e.target.classList.contains('rs')) { startResize(e, +th.dataset.c); return; }
  if (th) return;
  const td = e.target.closest('td'); if (!td) return;
  const tr = td.parentElement; if (tr.dataset.r === undefined) return;
  const r = +tr.dataset.r, ci = [...tr.children].indexOf(td);
  e.preventDefault(); if (edit) commitEdit();
  if (S.cols[ci].key === '#cb') { const c = S.view[r]; if (e.shiftKey && S.lastCb != null) { const [x, y] = [Math.min(S.lastCb, r), Math.max(S.lastCb, r)]; const on = !S.checked.has(c); for (let i = x; i <= y; i++) on ? S.checked.add(S.view[i]) : S.checked.delete(S.view[i]); } else { S.checked.has(c) ? S.checked.delete(c) : S.checked.add(c); } S.lastCb = r; renderBody(); renderSide(); return; }
  const now = Date.now(), dbl = !e.shiftKey && S.lastDown && S.lastDown.r === r && S.lastDown.c === ci && now - S.lastDown.t < 450; S.lastDown = { r, c: ci, t: now };
  if (e.shiftKey) S.b = { r, c: ci }; else { S.a = { r, c: ci }; S.b = { r, c: ci }; }
  if (dbl) { S.lastDown = null; setCur(S.view[r]); startEdit(); return; }
  dragging = true; setCur(S.view[r]); renderBody(); $('#gw').focus({ preventScroll: true });
});
document.addEventListener('mousemove', e => {
  if (!dragging) return; const td = document.elementFromPoint(e.clientX, e.clientY); const cell = td && td.closest && td.closest('#tb0 td'); if (!cell) return;
  const r = +cell.parentElement.dataset.r, c = [...cell.parentElement.children].indexOf(cell); if (isNaN(r)) return;
  if (S.b.r !== r || S.b.c !== c) { S.b = { r, c }; renderBody(); }
});
document.addEventListener('mouseup', () => dragging = false);
$('#gw').addEventListener('click', e => {
  if (e.target.id === 'cbAll') { const on = e.target.checked; for (const c of S.view) on ? S.checked.add(c) : S.checked.delete(c); renderBody(); renderSide(); return; }
  const th = e.target.closest('thead tr:first-child th'); if (th && th.dataset.c !== undefined && !e.target.classList.contains('rs')) { const key = S.cols[+th.dataset.c].key; if (!S.sort || S.sort.key !== key) S.sort = { key, dir: 1 }; else if (S.sort.dir === 1) S.sort.dir = -1; else S.sort = null; refresh({ cols: true }); }
});
$('#gw').addEventListener('input', e => { if (e.target.dataset.f !== undefined) { S.filters[e.target.dataset.f] = e.target.value; clearTimeout(S.ft); S.ft = setTimeout(() => { computeView(); clampSel(); renderBody(); }, 150); } });
function startResize(e, ci) {
  e.preventDefault(); const col = S.cols[ci], x0 = e.clientX, w0 = col.w;
  const mv = ev => { col.w = Math.max(40, w0 + ev.clientX - x0); $('#tbl colgroup').children[ci].style.width = col.w + 'px'; $('#tbl').style.width = S.cols.reduce((s, c) => s + c.w, 0) + 'px'; };
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); S.widths[col.key] = col.w; LS.set('widths', S.widths); if (col.stk) refresh({ cols: true }); };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
}
function setCur(c) { if (S.cur !== c) { S.cur = c; if (S.tab === 'comp' || S.tab === 'm3') renderSide(); if (S.viewName === '3d') show3dForCur(); } }
function scrollToCell(r, c) {
  const gw = $('#gw'), H = S.rowH, head = ($('#tbl thead') || {}).offsetHeight || 54;
  if (r * H < gw.scrollTop) gw.scrollTop = r * H; else if ((r + 1) * H + head > gw.scrollTop + gw.clientHeight) gw.scrollTop = (r + 1) * H + head - gw.clientHeight;
  const col = S.cols[c]; if (!col || col.stk) return; let x = 0; for (let i = 0; i < c; i++) x += S.cols[i].w; const stk = S.cols.filter(k => k.stk).reduce((s, k) => s + k.w, 0);
  if (x - stk < gw.scrollLeft) gw.scrollLeft = x - stk; else if (x + col.w > gw.scrollLeft + gw.clientWidth) gw.scrollLeft = x + col.w - gw.clientWidth;
}
function jumpTo(id) {
  let r = S.view.findIndex(c => c.id === id);
  if (r < 0) { S.filters = {}; S.search = ''; $('#search').value = ''; $('#stFilter').value = 'all'; refresh({ cols: true }); r = S.view.findIndex(c => c.id === id); }
  if (r < 0) return; S.a = { r, c: Math.max(2, S.a.c) }; S.b = { ...S.a }; setCur(S.view[r]); scrollToCell(r, S.a.c); renderBody();
}

/* ---------- правка ячейки ---------- */
let edit = null;
function startEdit(initial) {
  const c = S.view[S.a.r], col = S.cols[S.a.c]; if (!c || !col || col.sys) return;
  if (DT.isRO(col.key, c)) { toast(col.key === 'Category' || col.key === 'PatCategory' ? 'Категория копируется от донора: вкладка «Массово»' : col.key.startsWith('M3') || col.g === 'pat' ? (c.p ? 'Поле только для чтения' : 'Корпус не привязан') : 'Поле только для чтения'); return; }
  if (c.status === 'del') { toast('Запись помечена на удаление — сначала восстановите её'); return; }
  scrollToCell(S.a.r, S.a.c); renderBody();
  const td = $('#tb0').querySelector(`tr[data-r="${S.a.r}"]`).children[S.a.c];
  const gw = $('#gw'), rc = td.getBoundingClientRect(), gr = gw.getBoundingClientRect();
  const ta = document.createElement('textarea'); ta.className = 'editor';
  const v = DT.getVal(c, col.key);
  ta.value = initial != null ? initial : (v || '');
  Object.assign(ta.style, { left: (rc.left - gr.left + gw.scrollLeft) + 'px', top: (rc.top - gr.top + gw.scrollTop) + 'px', width: Math.max(rc.width, 280) + 'px', height: Math.max(rc.height, 28) + 'px' });
  gw.appendChild(ta); ta.focus(); if (initial == null) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(rc.height, ta.scrollHeight + 4) + 'px'; }; fit();
  ta.addEventListener('input', fit);
  if (col.key === 'Subfolder') ta.title = 'Подпапки: ' + (S.lib.subfolders.join(', ') || 'нет') + '. Новое имя будет добавлено в список.';
  if (col.key === 'M3Type') ta.title = 'File, IPC-7351 или Outline';
  edit = { ta, c, key: col.key };
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commitEdit(); move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); move(0, e.shiftKey ? -1 : 1); }
  });
  ta.addEventListener('blur', () => setTimeout(() => { if (edit && edit.ta === ta) commitEdit(); }, 0));
}
function cancelEdit() { if (!edit) return; edit.ta.remove(); edit = null; $('#gw').focus({ preventScroll: true }); }
function commitEdit() { if (!edit) return; const { ta, c, key } = edit; const v = ta.value; edit = null; ta.remove(); setCells([[c, key, v]], 'Правка ' + key); $('#gw').focus({ preventScroll: true }); }
function setCells(list, label) {
  let newSf = []; const shared = new Set();
  const n = op(label, tx => {
    let k = 0;
    for (const [c, key, v] of list) {
      if (c.status === 'del' || DT.isRO(key, c)) continue;
      DT.touch(tx, c);
      if (DT.isUF(key)) { if (DT.getVal(c, key) === undefined && v === '') continue; if (DT.setVal(c, key, v, { type: DT.getVal(c, key) === undefined ? defType(key) : undefined })) { k++; if (DT.isPatKey(key) && c.p && c.p.users > 1) shared.add(c.p.d.Pattern); } }
      else if (DT.setVal(c, key, v)) { k++; if (DT.isPatKey(key) && c.p && c.p.users > 1) shared.add(c.p.d.Pattern); if (key === 'Value' && isE()) { /* Value одинаково во всех секциях */ } if (key === 'Subfolder' && c.d.Subfolder && !S.lib.subfolders.includes(c.d.Subfolder)) { S.lib.subfolders.push(c.d.Subfolder); newSf.push(c.d.Subfolder); } }
    }
    return k;
  }, { cols: list.some(x => DT.isUF(x[1])) });
  if (newSf.length) toast('Добавлена подпапка: ' + [...new Set(newSf)].join(', '));
  else if (shared.size) toast('Изменён общий корпус ' + [...shared].slice(0, 3).join(', ') + ' — действует на все компоненты с ним', 3500);
  return n;
}
function move(dr, dc, extend) {
  const p = extend ? S.b : S.a;
  p.r = Math.min(Math.max(0, p.r + dr), S.view.length - 1); p.c = Math.min(Math.max(2, p.c + dc), S.cols.length - 1);
  if (!extend) S.b = { ...S.a };
  setCur(S.view[S.b.r]); scrollToCell(p.r, p.c); renderBody();
}
function selRange() { return { r0: Math.min(S.a.r, S.b.r), r1: Math.max(S.a.r, S.b.r), c0: Math.max(2, Math.min(S.a.c, S.b.c)), c1: Math.max(S.a.c, S.b.c) }; }
$('#gw').addEventListener('keydown', e => {
  if (edit || !S.lib || e.target.tagName === 'INPUT') return;
  const k = e.key, ctl = e.ctrlKey || e.metaKey;
  if (k.startsWith('Arrow')) { e.preventDefault(); const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k]; if (ctl) { d[0] *= 100000; d[1] *= 1000; } move(d[0], d[1], e.shiftKey); return; }
  if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); move((k === 'PageDown' ? 1 : -1) * Math.floor($('#gw').clientHeight / S.rowH - 3), 0, e.shiftKey); return; }
  if (k === 'Home') { e.preventDefault(); move(ctl ? -1e6 : 0, -1000, e.shiftKey); return; }
  if (k === 'End') { e.preventDefault(); move(ctl ? 1e6 : 0, 1000, e.shiftKey); return; }
  if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
  if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const R = selRange(), list = []; for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) list.push([S.view[r], S.cols[c].key, '']); setCells(list, 'Очистка'); return; }
  if (ctl && (k === 'z' || k === 'я' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctl && (k === 'y' || k === 'н')) { e.preventDefault(); redo(); return; }
  if (ctl && (k === 'd' || k === 'в')) { e.preventDefault(); fillDown(); return; }
  if (ctl && (k === 'a' || k === 'ф')) { e.preventDefault(); S.a = { r: 0, c: 2 }; S.b = { r: S.view.length - 1, c: S.cols.length - 1 }; renderBody(); return; }
  if (ctl && (k === 'f' || k === 'а')) { e.preventDefault(); $('#search').focus(); return; }
  if (k === ' ' && S.cols[S.a.c].key === '#cb') { e.preventDefault(); const c = S.view[S.a.r]; S.checked.has(c) ? S.checked.delete(c) : S.checked.add(c); renderBody(); return; }
  if (!ctl && !e.altKey && k.length === 1) { e.preventDefault(); startEdit(k); }
});
function fillDown() {
  const R = selRange(); if (R.r1 === R.r0) return; const list = [];
  for (let c = R.c0; c <= R.c1; c++) { const key = S.cols[c].key, v = DT.getVal(S.view[R.r0], key); if (v === undefined) continue; for (let r = R.r0 + 1; r <= R.r1; r++) list.push([S.view[r], key, v]); }
  const n = setCells(list, 'Заполнить вниз'); toast('Заполнено ячеек: ' + (n || 0));
}
document.addEventListener('copy', e => {
  if (!S.lib || edit || document.activeElement !== $('#gw')) return;
  const R = selRange(), lines = [];
  for (let r = R.r0; r <= R.r1; r++) { const row = []; for (let c = R.c0; c <= R.c1; c++) { const v = cellText(S.view[r], S.cols[c].key); row.push(/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v); } lines.push(row.join('\t')); }
  e.clipboardData.setData('text/plain', lines.join('\r\n')); e.preventDefault(); toast('Скопировано ' + (R.r1 - R.r0 + 1) + '×' + (R.c1 - R.c0 + 1));
});
document.addEventListener('paste', e => {
  if (!S.lib || edit || document.activeElement !== $('#gw')) return;
  e.preventDefault(); const t = e.clipboardData.getData('text/plain'); if (!t) return;
  const rows = parseTSV(t); const R = selRange(); const list = [];
  if (rows.length === 1 && rows[0].length === 1) { for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) list.push([S.view[r], S.cols[c].key, rows[0][0]]); }
  else rows.forEach((row, i) => row.forEach((v, j) => { const r = R.r0 + i, c = R.c0 + j; if (r < S.view.length && c < S.cols.length) list.push([S.view[r], S.cols[c].key, v]); }));
  const n = setCells(list, 'Вставка'); toast('Вставлено ячеек: ' + (n || 0) + (rows.length + R.r0 > S.view.length ? ' (лишние строки отброшены)' : ''));
});
function parseTSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') { q = true; continue; }
    if (ch === '\t') { row.push(f); f = ''; continue; }
    if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; continue; }
    f += ch; }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* ---------- боковая панель ---------- */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.t; $$('#tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('#side .pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + S.tab)); renderSide(); });
function renderSide() { if (!S.lib) return; ({ comp: renderComp, m3: renderM3Pane, mass: renderMass, tpl: renderTpl, lib: renderLib, chk: renderChk })[S.tab](); }
function targets(mode) {
  mode = mode || ($('input[name=tgt]:checked') || {}).value || 'view';
  const list = mode === 'chk' ? S.lib.rows.filter(c => S.checked.has(c)) : mode === 'all' ? S.lib.rows : S.view;
  return list.filter(c => c.status !== 'del');
}
function tgtHtml() {
  const k = S.lib.rows.filter(c => S.checked.has(c) && c.status !== 'del').length, v = S.view.filter(c => c.status !== 'del').length, a = S.lib.rows.filter(c => c.status !== 'del').length;
  const cur = S.tgt || (k ? 'chk' : 'view');
  return `<div class="row"><b>Применить к:</b>
    <label><input type="radio" name="tgt" value="chk" ${cur === 'chk' ? 'checked' : ''} ${k ? '' : 'disabled'}> отмеченным (${k})</label>
    <label><input type="radio" name="tgt" value="view" ${cur === 'view' ? 'checked' : ''}> отфильтрованным (${v})</label>
    <label><input type="radio" name="tgt" value="all" ${cur === 'all' ? 'checked' : ''}> всем (${a})</label></div>`;
}
document.addEventListener('change', e => { if (e.target.name === 'tgt') S.tgt = e.target.value; });
const ufList = (c, pre) => pre === 'UF:' ? c : c.p;
function ufEditor(c, pre) {
  const obj = ufList(c, pre), list = obj.uf, orig = obj.o.uf;
  return `<div class="ufl" data-pre="${pre}">${list.map((f, i) => { const o = orig.find(x => x.n === f.n); const ch = obj.status === 'new' || !o || o.v !== f.v || o.t !== f.t;
    return `<div class="ufr ${ch ? 'chg' : ''}" data-i="${i}"><input data-k="n" value="${esc(f.n)}" title="Имя поля"><input data-k="v" value="${esc(f.v)}" title="${esc(f.v)}"><select data-k="t"><option value="0" ${f.t ? '' : 'selected'}>текст</option><option value="1" ${f.t ? 'selected' : ''}>ссылка</option></select><span class="b"><button data-a="up" title="Выше">↑</button><button data-a="dn" title="Ниже">↓</button><button data-a="rm" title="Удалить поле">×</button></span></div>`; }).join('')}</div>
    <div class="row"><button class="small" data-a="add" data-pre="${pre}">+ поле</button><button class="small" data-a="addtpl" data-pre="${pre}" title="Добавить недостающие поля из набора «Поля по умолчанию»">+ недостающие по умолчанию</button><button class="small" data-a="ordtpl" data-pre="${pre}">упорядочить по умолчанию</button></div>`;
}
function fieldInput(c, f, ro) {
  const t = DT.target(c, f.key); const v = t ? (DT.getVal(c, f.key) || '') : ''; const chg = DT.isChanged(c, f.key);
  const st = chg ? 'style="background:var(--chg)"' : '';
  let ctl;
  if (DT.isRO(f.key, c) || ro) ctl = `<div class="v">${esc(v) || '—'}</div>`;
  else if (f.key === 'Subfolder') ctl = `<select data-fk="${f.key}" ${st}><option value="">— корень —</option>${S.lib.subfolders.map(s => `<option ${s === v ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  else if (f.key === 'M3Type') ctl = `<select data-fk="${f.key}" ${st}>${['', 'File', 'IPC-7351', 'Outline'].map(x => `<option value="${x}" ${x === v ? 'selected' : ''}>${x || '— нет —'}</option>`).join('')}</select>`;
  else ctl = `<input data-fk="${f.key}" value="${esc(v)}" ${st}>`;
  return `<label title="${esc(f.key)}">${esc(f.label)}</label>` + ctl;
}
function renderComp() {
  const c = S.cur, P = $('#p-comp');
  if (!c || !S.lib.rows.includes(c)) { P.innerHTML = '<p class="muted">Выберите строку в таблице.</p>'; return; }
  const st = { orig: '', new: `<span class="ok">новая, копия #${c.src}</span>`, del: '<span class="err">помечена на удаление</span>' }[c.status];
  let h = `<h3>#${c.id} · ${esc(rowName(c))} ${st}</h3><div class="row">
    <button class="small" data-a="clone">Клонировать</button>
    <button class="small" data-a="${c.status === 'del' ? 'undel' : 'del'}">${c.status === 'del' ? 'Восстановить' : 'Удалить'}</button>
    <button class="small" data-a="reset" ${DT.compChanged(c) && c.status !== 'new' ? '' : 'disabled'}>Отменить изменения записи</button>
    ${c.p ? '<button class="small" data-a="go3d">3D-просмотр</button>' : ''}</div>`;
  const ro = c.status === 'del';
  const grp = (g, title) => { const fs = DT.FIELDS.filter(x => x.g === g && DT.fieldAvail(S.lib, x.key)); if (!fs.length) return ''; return `<h3><span class="gb ${g}">${GB[g]}</span>${title}</h3><div class="f">` + fs.map(f => fieldInput(c, f, ro)).join('') + '</div>'; };
  if (isE()) h += grp('svc', 'Служебные поля') + grp('sup', 'Поставщик');
  if (c.p) {
    if (isE() && c.p.users > 1) h += `<p class="warn" style="font-size:12px">Корпус «${esc(c.p.d.Pattern)}» общий для ${c.p.users} компонентов этой библиотеки — правка корпуса, его полей и 3D действует на все.</p>`;
    h += grp('pat', 'Корпус') + grp('m3', '3D-модель');
  } else h += '<p class="muted">Корпус не привязан</p>';
  if (isE()) h += `<h3><span class="gb uf">UF</span>Пользовательские поля компонента (${c.uf.length})</h3>` + (ro ? '' : ufEditor(c, 'UF:'));
  if (c.p) h += `<h3><span class="gb puf">PUF</span>Пользовательские поля корпуса (${c.p.uf.length})</h3>` + (ro ? '' : ufEditor(c, 'PUF:'));
  if (isE()) h += `<p class="muted" style="margin-top:14px">Секции: ${esc(c.d.Parts)}. Поля компонента хранятся в первой секции, Value записывается во все секции.</p>`;
  P.innerHTML = h;
}
$('#p-comp').addEventListener('change', e => {
  const c = S.cur; if (!c) return; const t = e.target;
  if (t.dataset.fk) { setCells([[c, t.dataset.fk, t.value]], 'Правка ' + t.dataset.fk); return; }
  const row = t.closest('.ufr'); if (!row) return; const pre = row.parentElement.dataset.pre, i = +row.dataset.i, k = t.dataset.k;
  op('Поле ' + pre, tx => { DT.touch(tx, c); const L = ufList(c, pre).uf; const f = L[i]; if (!f) return;
    if (k === 'n') { const nn = DT.clean(t.value); if (!nn.trim()) { toast('Имя поля не может быть пустым'); return; } if (L.some((x, j) => j !== i && x.n === nn)) toast('Внимание: поле «' + nn + '» уже есть'); f.n = nn; }
    if (k === 'v') f.v = DT.clean(t.value); if (k === 't') f.t = +t.value; }, { cols: k === 'n' });
});
$('#p-comp').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !S.cur) return; const c = S.cur, a = b.dataset.a;
  if (a === 'go3d') { setView('3d'); return; }
  if (a === 'clone') { const name = prompt('Имя новой записи', DT.uniqueName(S.lib, rowName(c) + '_copy')); if (name == null) return; const nc = op('Клонирование', tx => { const n = DT.cloneRow(S.lib, c, tx); DT.setVal(n, nameKey(), name); return n; }); if (nc) { S.cur = nc; jumpTo(nc.id); } return; }
  if (a === 'del' || a === 'undel') { op(a === 'del' ? 'Удаление' : 'Восстановление', tx => { DT.touch(tx, c); c.status = a === 'del' ? 'del' : (c.o.status === 'new' ? 'new' : 'orig'); }); return; }
  if (a === 'reset') { op('Сброс записи', tx => { DT.touch(tx, c); for (const x of [c, c.p]) if (x && x.o) { x.d = { ...x.o.d }; x.uf = x.o.uf.map(f => Object.assign({ ...f }, {})); for (let j = 0; j < x.uf.length; j++) if (x.o.uf[j].node) Object.defineProperty(x.uf[j], 'node', { value: x.o.uf[j].node, enumerable: false, writable: true }); x.cat = null; } }, { cols: true }); return; }
  const row = b.closest('.ufr'), pre = row ? row.parentElement.dataset.pre : b.dataset.pre; if (!pre) return;
  op('Поля ' + pre, tx => { DT.touch(tx, c); const obj = ufList(c, pre), L = obj.uf;
    if (row) { const i = +row.dataset.i; if (a === 'rm') L.splice(i, 1); if (a === 'up' && i > 0) [L[i - 1], L[i]] = [L[i], L[i - 1]]; if (a === 'dn' && i < L.length - 1) [L[i + 1], L[i]] = [L[i], L[i + 1]]; }
    if (a === 'add') { const n = prompt('Имя нового пользовательского поля'); if (!n || !n.trim()) return; if (L.some(x => x.n === n)) { toast('Поле уже есть'); return; } L.push({ n: DT.clean(n), v: '', t: defType(pre + n) }); }
    if (a === 'addtpl' || a === 'ordtpl') { if (!S.tpl || !S.tpl.length) { toast('Набор «Поля по умолчанию» пуст'); return; } DT.applyTemplate(S.lib, [c], S.tpl.map(f => ({ ...f, scope: f.scope.includes(pre === 'UF:' ? 'C' : 'P') ? (pre === 'UF:' ? 'C' : 'P') : '' })), a === 'addtpl' ? 'add' : 'order', tx); }
  }, { cols: true });
});

/* ---------- массовая правка ---------- */
function colOptions(sel) {
  const byG = {}; for (const c of S.allCols) if (!c.sys && !c.ro) (byG[c.g] = byG[c.g] || []).push(c);
  return Object.entries(byG).map(([g, cs]) => `<optgroup label="${GROUPS[g]}">${cs.map(c => `<option value="${esc(c.key)}" ${c.key === sel ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('') + (isE() ? `<option value="#newUF">+ новое поле компонента…</option>` : '') + `<option value="#newPUF">+ новое поле корпуса…</option>`;
}
function renderMass() {
  const P = $('#p-mass'); const m = S.mass || (S.mass = { col: isE() ? 'Value' : 'PatManufacturer', op: 'set', val: '', find: '', onlyEmpty: false, create: true, type: 'keep' });
  const curCol = S.cols[S.a.c] && !S.cols[S.a.c].sys && !S.cols[S.a.c].ro ? S.cols[S.a.c].key : m.col;
  P.innerHTML = tgtHtml() + `
  <div class="box"><h3>Значение столбца</h3>
  <div class="f"><label>Столбец</label><select id="mCol">${colOptions(m.colLocked ? m.col : curCol)}</select>
  <label id="mNewL" hidden>Имя нового поля</label><input id="mNew" hidden>
  <label>Действие</label><select id="mOp">
    <option value="set">записать значение</option><option value="replace">найти и заменить</option><option value="regex">заменить по регулярному выражению</option>
    <option value="prefix">добавить в начало</option><option value="suffix">добавить в конец</option><option value="trim">убрать пробелы по краям</option><option value="clear">очистить</option>
    <option value="upper">В ВЕРХНИЙ РЕГИСТР</option><option value="lower">в нижний регистр</option>
    <option value="deluf">удалить пользовательское поле</option><option value="type">только сменить тип поля</option></select>
  <label id="mFindL">Найти</label><input id="mFind" value="${esc(m.find)}">
  <label id="mValL">Значение</label><input id="mVal" value="${esc(m.val)}" placeholder="например: {Value} {Pattern}">
  <label>Тип поля</label><select id="mType"><option value="keep">не менять (новым — по умолчанию)</option><option value="0">текст</option><option value="1">ссылка</option></select>
  </div>
  <div class="row"><label><input type="checkbox" id="mEmpty" ${m.onlyEmpty ? 'checked' : ''}> только пустые / отсутствующие</label>
  <label><input type="checkbox" id="mCreate" ${m.create ? 'checked' : ''}> создавать поле, если его нет</label></div>
  <div class="row"><button class="pri" id="mApply">Применить</button><span class="muted" id="mPrev"></span></div>
  <details><summary>Подстановки в значении</summary><p class="muted"><code>{Name}</code> <code>{RefDes}</code> <code>{Value}</code> <code>{Manufacturer}</code> <code>{Pattern}</code> <code>{M3Var}</code> <code>{#}</code> — ID, <code>{UF:имя}</code>, <code>{PUF:имя}</code>. Пример: <code>%my3dmodels%\\Res SMD\\{Pattern}.step</code> для столбца M3Var. В регулярной замене доступны <code>$1</code>, <code>$2</code>…</p></details>
  </div>
  <div class="box"><h3>Переименовать пользовательское поле</h3>
  <div class="row"><select id="rnFrom">${S.allCols.filter(c => c.g === 'uf' || c.g === 'puf').map(c => `<option value="${esc(c.key)}">${c.g === 'uf' ? 'UF' : 'PUF'}: ${esc(c.label)}</option>`).join('')}</select> → <input id="rnTo" style="width:130px"><button id="rnGo">Переименовать</button></div></div>
  <div class="box"><h3>Категория DipTrace</h3><p class="muted">Категории ссылаются на внутреннюю базу DipTrace, поэтому их копируют от записи-донора (ID).</p>
  <div class="row">Донор ID <input type="number" id="catDonor" style="width:80px" value="${S.cur ? S.cur.id : ''}"><span class="muted" id="catInfo"></span><button id="catGo">Скопировать категорию</button><button id="catReset" class="small">Отменить копирование</button></div></div>
  <div class="box"><h3>Создать копии текущей записи</h3>
  <p class="muted">Донор: ${S.cur ? '#' + S.cur.id + ' ' + esc(rowName(S.cur)) : 'не выбран'} — копируются ${isE() ? 'символ, корпус (общий), 3D' : 'площадки, графика, 3D'} и все поля. Строка: ${isE() ? '<code>Имя;Value;RefDes</code>' : '<code>Имя корпуса</code>'}.</p>
  <textarea id="clList" rows="5" style="width:100%" placeholder="${isE() ? 'RC0603FR-0710KL;10k&#10;RC0603FR-0722KL;22k' : 'SOIC-8_EP&#10;SOIC-14'}"></textarea>
  <div class="row"><button id="clGo" ${S.cur ? '' : 'disabled'}>Создать</button></div></div>`;
  const upd = () => {
    const o = $('#mOp').value, col = $('#mCol').value; const isuf = DT.isUF(col) || col.startsWith('#new');
    $('#mNewL').hidden = $('#mNew').hidden = !col.startsWith('#new');
    $('#mFindL').hidden = $('#mFind').hidden = !(o === 'replace' || o === 'regex');
    $('#mValL').hidden = $('#mVal').hidden = !['set', 'replace', 'regex', 'prefix', 'suffix'].includes(o);
    $('#mValL').textContent = o === 'replace' || o === 'regex' ? 'Заменить на' : 'Значение';
    $('#mType').disabled = !isuf; $('#mCreate').disabled = !isuf;
    $('#mPrev').textContent = 'строк: ' + targets().length;
  };
  $('#mOp').value = m.op; $('#mType').value = m.type; upd();
  const catLabel = d => d ? (isE() ? d.d.Category : d.d.PatCategory) || '(без категории)' : 'не найден';
  P.oninput = P.onchange = e => { if (['mOp', 'mCol', 'mType'].includes(e.target.id) || e.target.name === 'tgt') { m.op = $('#mOp').value; m.type = $('#mType').value; if (e.target.id === 'mCol') { m.col = e.target.value; m.colLocked = true; } upd(); } m.val = $('#mVal').value; m.find = $('#mFind').value; m.onlyEmpty = $('#mEmpty').checked; m.create = $('#mCreate').checked;
    if (e.target.id === 'catDonor') $('#catInfo').textContent = catLabel(S.lib.rows.find(x => x.id === +e.target.value)); };
  if (S.cur) $('#catInfo').textContent = catLabel(S.cur);
  $('#mApply').onclick = massApply;
  $('#rnGo').onclick = () => { const from = $('#rnFrom').value, to = DT.clean($('#rnTo').value.trim()); if (!to) return; const pre = from.startsWith('UF:') ? 'UF:' : 'PUF:', fn = DT.ufName(from); let conflict = 0; const done = new Set();
    const n = op('Переименование поля', tx => { let k = 0; for (const c of targets()) { const obj = ufList(c, pre); if (!obj || done.has(obj)) continue; done.add(obj); const L = obj.uf; const f = L.find(x => x.n === fn); if (!f) continue; if (L.some(x => x.n === to)) { conflict++; continue; } DT.touch(tx, c); f.n = to; k++; } return k; }, { cols: true });
    toast(`Переименовано: ${n || 0}` + (conflict ? `, пропущено ${conflict} (поле «${to}» уже есть)` : '')); };
  $('#catGo').onclick = () => { const d = S.lib.rows.find(x => x.id === +$('#catDonor').value); if (!d) { toast('Донор не найден'); return; } const n = op('Копирование категории', tx => { let k = 0; for (const c of targets()) { if (c === d) continue; DT.touch(tx, c); c.cat = d.id; k++; } return k; }); toast('Категория назначена: ' + (n || 0)); };
  $('#catReset').onclick = () => { op('Отмена копирования категории', tx => { for (const c of targets()) if (c.cat != null) { DT.touch(tx, c); c.cat = null; } }); };
  $('#clGo').onclick = () => { const donor = S.cur; const lines = $('#clList').value.split(/\r?\n/).map(l => l.split(/\t|;/).map(s => s.trim())).filter(l => l[0]);
    if (!lines.length) return; const names = new Set(S.lib.rows.filter(c => c.status !== 'del').map(rowName)); const dup = lines.filter(l => names.has(l[0])).map(l => l[0]);
    const n = op('Создание копий', tx => { for (const l of lines) { const c = DT.cloneRow(S.lib, donor, tx); DT.setVal(c, nameKey(), l[0]); if (isE()) { if (l[1]) DT.setVal(c, 'Value', l[1]); if (l[2]) DT.setVal(c, 'RefDes', l[2]); } } return lines.length; });
    toast(`Создано: ${n}` + (dup.length ? `. Внимание, повторяющиеся имена: ${dup.slice(0, 5).join(', ')}` : ''), 4000); $('#clList').value = ''; };
}
function massApply() {
  const m = S.mass; let col = $('#mCol').value;
  if (col.startsWith('#new')) { const n = DT.clean($('#mNew').value.trim()); if (!n) { toast('Укажите имя нового поля'); return; } col = (col === '#newUF' ? 'UF:' : 'PUF:') + n; }
  const o = m.op, isuf = DT.isUF(col); let re = null;
  if (o === 'regex') { try { re = new RegExp(m.find, 'g'); } catch (e) { toast('Ошибка в регулярном выражении: ' + e.message); return; } }
  const tsel = m.type === 'keep' ? undefined : +m.type; const done = new Set();
  const n = op('Массовая правка ' + col, tx => {
    let k = 0;
    for (const c of targets()) {
      if (DT.isRO(col, c)) continue;
      const tgt = DT.target(c, col); if (DT.isPatKey(col)) { if (done.has(tgt)) continue; done.add(tgt); }
      const cur = DT.getVal(c, col);
      if (m.onlyEmpty && cur !== undefined && cur !== '') continue;
      if (isuf && cur === undefined && !m.create && o !== 'deluf') continue;
      DT.touch(tx, c);
      if (o === 'deluf') { if (isuf && DT.setVal(c, col, null)) k++; continue; }
      if (o === 'type') { if (isuf && tsel !== undefined && DT.setType(c, col, tsel)) k++; continue; }
      const v0 = cur || ''; let v = v0; const val = DT.expand(m.val, c);
      if (o === 'set') v = val; else if (o === 'replace') v = m.find ? v0.split(m.find).join(val) : v0; else if (o === 'regex') v = v0.replace(re, m.val.replace(/\{([^{}]+)\}/g, x => DT.expand(x, c)));
      else if (o === 'prefix') v = val + v0; else if (o === 'suffix') v = v0 + val; else if (o === 'trim') v = v0.trim(); else if (o === 'clear') v = ''; else if (o === 'upper') v = v0.toUpperCase(); else if (o === 'lower') v = v0.toLowerCase();
      if (isuf && cur === undefined && v === '' && o !== 'set') continue;
      if (DT.setVal(c, col, v, { type: tsel !== undefined ? tsel : (cur === undefined ? defType(col) : undefined) })) k++;
      if (col === 'Subfolder' && c.d.Subfolder && !S.lib.subfolders.includes(c.d.Subfolder)) S.lib.subfolders.push(c.d.Subfolder);
    }
    return k;
  }, { cols: isuf });
  toast('Изменено записей: ' + (n || 0));
}

/* ---------- поля по умолчанию ---------- */
function renderTpl() {
  const P = $('#p-tpl'); const T = S.tpl || [];
  P.innerHTML = `<p class="muted">Набор общих пользовательских полей для компонентов и/или корпусов: имя, тип, значение по умолчанию (с подстановками <code>{Value}</code>, <code>{UF:…}</code>) и область. Хранится в браузере, выгружается в JSON и на лист «Поля_по_умолчанию» в Excel.</p>
  <div class="row"><button class="small" data-a="fromlib">Собрать из библиотеки</button> встречаются не реже чем у <input type="number" id="tplShare" value="50" min="1" max="100" style="width:56px">% записей</div>
  <div class="ufl tpl">${T.map((f, i) => `<div class="ufr" data-i="${i}"><input data-k="n" value="${esc(f.n)}" placeholder="имя"><select data-k="t"><option value="0" ${f.t ? '' : 'selected'}>текст</option><option value="1" ${f.t ? 'selected' : ''}>ссылка</option></select><input data-k="v" value="${esc(f.v)}" placeholder="по умолчанию"><select data-k="scope" title="Область: компонент / корпус / оба"><option value="C" ${f.scope === 'C' ? 'selected' : ''}>комп.</option><option value="P" ${f.scope === 'P' ? 'selected' : ''}>корп.</option><option value="CP" ${f.scope === 'CP' ? 'selected' : ''}>оба</option></select><span class="b"><button data-a="up">↑</button><button data-a="dn">↓</button><button data-a="rm">×</button></span></div>`).join('') || '<p class="muted">Набор пуст.</p>'}</div>
  <div class="row"><button class="small" data-a="add">+ поле</button><button class="small" data-a="save">Сохранить JSON</button><button class="small" data-a="load">Загрузить JSON</button><button class="small" data-a="clr">Очистить</button></div>
  ${tgtHtml()}
  <div class="box"><div class="row" style="flex-direction:column;align-items:stretch">
  <button data-a="op-add">Добавить недостающие поля (со значением по умолчанию)</button>
  <button data-a="op-fill">Заполнить пустые поля значениями по умолчанию</button>
  <button data-a="op-order">Упорядочить поля: сначала по набору, затем остальные</button>
  <button data-a="op-types">Привести типы полей к набору</button>
  <button data-a="op-purge">Удалить пустые поля, которых нет в наборе</button></div></div>`;
}
function saveTpl() { LS.set('tpl', S.tpl); }
$('#p-tpl').addEventListener('change', e => { const row = e.target.closest('.ufr'); if (!row || e.target.name === 'tgt') return; const f = S.tpl[+row.dataset.i], k = e.target.dataset.k; f[k] = k === 't' ? +e.target.value : k === 'n' ? DT.clean(e.target.value.trim()) : e.target.value; saveTpl(); if (k === 'n' || k === 'scope') refresh({ cols: true }); });
$('#p-tpl').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a; S.tpl = S.tpl || [];
  const row = b.closest('.ufr'); if (row) { const i = +row.dataset.i, T = S.tpl; if (a === 'rm') T.splice(i, 1); if (a === 'up' && i > 0) [T[i - 1], T[i]] = [T[i], T[i - 1]]; if (a === 'dn' && i < T.length - 1) [T[i + 1], T[i]] = [T[i], T[i + 1]]; saveTpl(); renderTpl(); return; }
  if (a === 'fromlib') { S.tpl = DT.templateFromLib(S.lib, (+$('#tplShare').value || 50) / 100); saveTpl(); refresh({ cols: true }); toast('Полей в наборе: ' + S.tpl.length); return; }
  if (a === 'add') { S.tpl.push({ n: 'new_field', t: 0, v: '', scope: isE() ? 'C' : 'P' }); saveTpl(); renderTpl(); return; }
  if (a === 'clr') { if (confirm('Очистить набор полей по умолчанию?')) { S.tpl = []; saveTpl(); refresh({ cols: true }); } return; }
  if (a === 'save') { download(new Blob([JSON.stringify({ format: 'dtlib-default-fields', version: 1, fields: S.tpl }, null, 2)], { type: 'application/json' }), 'поля_по_умолчанию.json'); return; }
  if (a === 'load') { $('#fJson').click(); return; }
  if (a.startsWith('op-')) {
    if (!S.tpl.length) { toast('Набор пуст'); return; }
    const opn = a.slice(3); if (opn === 'purge' && !confirm('Удалить у выбранных записей все пустые поля, которых нет в наборе?')) return;
    const n = op('Поля по умолчанию: ' + b.textContent, tx => DT.applyTemplate(S.lib, targets(), S.tpl, opn, tx), { cols: true });
    toast('Затронуто наборов полей: ' + (n || 0));
  }
});
$('#fJson').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const j = JSON.parse(await f.text()); const arr = Array.isArray(j) ? j : j.fields; if (!Array.isArray(arr)) throw new Error('нет списка fields'); S.tpl = arr.map(x => ({ n: DT.clean(x.n || x.name || ''), t: +(x.t != null ? x.t : x.type) ? 1 : 0, v: x.v != null ? String(x.v) : x.default || '', scope: ['C', 'P', 'CP'].includes(x.scope) ? x.scope : 'C' })).filter(x => x.n); saveTpl(); refresh({ cols: true }); toast('Загружено полей: ' + S.tpl.length); } catch (er) { toast('Ошибка JSON: ' + er.message); } });

/* ---------- библиотека ---------- */
function renderLib() {
  const L = S.lib, P = $('#p-lib'), E = S.E;
  const op0 = L.oldPaths || [];
  P.innerHTML = `<div class="f"><label>Имя библиотеки</label><input id="lName" value="${esc(L.name)}"><label>Описание (Hint)</label><input id="lHint" value="${esc(L.hint)}"></div>
  ${isE() || L.subfolders.length ? `<h3>Подпапки</h3><div class="ufl">${L.subfolders.map((s, i) => `<div class="ufr" style="grid-template-columns:1fr auto auto" data-i="${i}"><input value="${esc(s)}" data-sf="${i}"><span class="muted">${L.rows.filter(c => c.status !== 'del' && c.d.Subfolder === s).length} шт.</span><span class="b"><button data-a="sfrm" title="Удалить подпапку (компоненты переходят в корень)">×</button></span></div>`).join('') || '<p class="muted">Подпапок нет.</p>'}</div>
  <div class="row"><button class="small" data-a="sfadd">+ подпапка</button></div>` : ''}
  ${op0.length ? `<div class="box"><b class="warn">Устаревшие ссылки .eli/.lib в файле: ${op0.length}</b><div class="row"><button class="small" data-a="fixpaths">Исправить пути…</button></div></div>` : ''}
  <h3>Сведения</h3><div class="f"><label>Файл</label><div class="v">${esc(E.win || E.name)}</div><label>Запись</label><div class="v">${E.handle ? 'на место, копия в _backup' : 'загрузкой файла (папка не подключена)'}</div><label>Формат</label><div class="v">${esc(L.type)}, версия ${esc(L.version)}, единицы ${esc(L.units)}</div><label>Записей</label><div class="v">${L.rows.length}${isE() ? `, корпусов внутри: ${L.pats.length}` : ''}</div><label>Польз. полей (имён)</label><div class="v">${isE() ? `компонент: ${DT.ufStats(L, 'UF:').length}, ` : ''}корпус: ${DT.ufStats(L, 'PUF:').length}</div></div>`;
}
$('#p-lib').addEventListener('change', e => {
  const t = e.target; const L = S.lib;
  if (t.id === 'lName' || t.id === 'lHint') { op('Свойства библиотеки', () => { L[t.id === 'lName' ? 'name' : 'hint'] = DT.clean(t.value); }); return; }
  if (t.dataset.sf !== undefined) { const i = +t.dataset.sf, old = L.subfolders[i], nn = DT.clean(t.value.trim()); if (!nn || L.subfolders.includes(nn)) { toast('Имя пустое или уже есть'); renderLib(); return; }
    op('Переименование подпапки', tx => { L.subfolders[i] = nn; for (const c of L.rows) if (c.d.Subfolder === old) { DT.touch(tx, c); c.d.Subfolder = nn; } }); }
});
$('#p-lib').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const L = S.lib;
  if (b.dataset.a === 'fixpaths') { fixPathsDialog(S.E, 'lib'); return; }
  if (b.dataset.a === 'sfadd') { const n = prompt('Имя подпапки'); if (!n || L.subfolders.includes(n)) return; if (!L.hasSub) L.hasSub = true; op('Новая подпапка', () => { L.subfolders.push(DT.clean(n)); }, { cols: true }); }
  if (b.dataset.a === 'sfrm') { const i = +b.closest('.ufr').dataset.i, s = L.subfolders[i]; op('Удаление подпапки', tx => { L.subfolders.splice(i, 1); for (const c of L.rows) if (c.d.Subfolder === s) { DT.touch(tx, c); c.d.Subfolder = ''; } }); }
});

/* ---------- проверка и журнал ---------- */
function renderChk() {
  const P = $('#p-chk');
  let h = `<div class="row"><button class="pri" data-a="run">Проверить библиотеку</button><button data-a="log">Журнал изменений</button><button data-a="logcsv">Журнал в CSV</button></div>`;
  if (!S.chk) { P.innerHTML = h + `<p class="muted">Проверка: уникальность имён, пустые RefDes, повторяющиеся пользовательские поля, ссылки подпапок, наличие файлов 3D-моделей в подключённых папках. Сверка с другими базами и проектами — во вкладке «Кросс-проверка».</p>`; return; }
  const { kind, items } = S.chk;
  if (kind === 'val') { const cnt = l => items.filter(x => x.lvl === l).length; h += `<p>Ошибок: <b class="l err">${cnt('err')}</b>, предупреждений: <b class="l warn">${cnt('warn')}</b>, замечаний: ${cnt('info')}</p>` + items.slice(0, 1500).map(x => `<div class="msg" data-id="${x.id}"><span class="l ${x.lvl}">${{ err: 'ошибка', warn: 'внимание', info: 'инфо' }[x.lvl]}</span> ${x.id ? '#' + x.id + ' ' + esc(x.name) + ': ' : ''}${esc(x.msg)}</div>`).join(''); }
  else h += `<p>Изменённых записей: <b>${items.length}</b></p>` + items.slice(0, 800).map(({ c, d }) => `<div class="msg" data-id="${c.id}"><b>#${c.id} ${esc(rowName(c))}</b>${d.map(x => `<div class="muted">${esc(x.f)}: «${esc(x.a)}» → «${esc(x.b)}»</div>`).join('')}</div>`).join('');
  P.innerHTML = h;
}
function changeLog(lib = S.lib) { return lib.rows.filter(c => DT.compChanged(c)).map(c => ({ c, d: DT.diffComp(c) })).filter(x => x.d.length); }
$('#p-chk').addEventListener('click', e => {
  const m = e.target.closest('.msg'); if (m && m.dataset.id) { jumpTo(+m.dataset.id); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'run') { S.chk = { kind: 'val', items: DT.validate(S.lib) }; renderChk(); }
  if (b.dataset.a === 'log') { S.chk = { kind: 'log', items: changeLog() }; renderChk(); }
  if (b.dataset.a === 'logcsv') { const rows = [['ID', 'Имя', 'Поле', 'Было', 'Стало']]; for (const { c, d } of changeLog()) for (const x of d) rows.push([c.id, rowName(c), x.f, x.a, x.b]); download(new Blob([XL.toCSV(rows)], { type: 'text/csv' }), baseName() + '_журнал_' + stamp() + '.csv'); }
});

/* ---------- выбор столбцов ---------- */
$('#bCols').onclick = async () => {
  const live = S.lib.rows.filter(c => c.status !== 'del').length || 1;
  const html = `<div class="row"><button class="small" data-q="all">показать все</button><button class="small" data-q="none">скрыть все</button><button class="small" data-q="rare">скрыть редкие (&lt; 5%)</button><input type="text" id="ccf" placeholder="фильтр" style="width:160px"></div><div class="colchooser" id="cc">${S.allCols.filter(c => !c.sys).map(c => `<label data-g="${c.g}"><input type="checkbox" data-k="${esc(c.key)}" ${S.hidden.has(c.key) ? '' : 'checked'}><span class="gb ${c.g}">${GB[c.g]}</span>${esc(c.label)} <span class="muted">${c.count != null ? c.count + ' / ' + live : esc(c.title)}</span></label>`).join('')}</div><p class="muted">Скрытые столбцы выгружаются в Excel/CSV, если не выбран режим «только видимые».</p>`;
  const btns = [{ t: 'Отмена', v: 0 }, { t: 'Применить', v: 1, pri: true }];
  btns.onOpen = bg => { bg.querySelector('#ccf').oninput = e => { const q = e.target.value.toLowerCase(); bg.querySelectorAll('#cc label').forEach(l => l.hidden = !l.textContent.toLowerCase().includes(q)); };
    bg.querySelectorAll('[data-q]').forEach(b => b.onclick = () => bg.querySelectorAll('#cc input').forEach(i => { const c = S.allCols.find(x => x.key === i.dataset.k); if (i.closest('label').hidden) return; i.checked = b.dataset.q === 'all' ? true : b.dataset.q === 'none' ? false : !(c.count != null && c.count / live < .05); }));
    S._cc = bg; };
  if (await modal('Столбцы таблицы', html, btns) === 1) { S._cc.querySelectorAll('#cc input').forEach(i => i.checked ? S.hidden.delete(i.dataset.k) : S.hidden.add(i.dataset.k)); LS.set('hidden', [...S.hidden]); refresh({ cols: true }); }
};
$('#bClrF').onclick = () => { S.filters = {}; S.search = ''; $('#search').value = ''; $('#stFilter').value = 'all'; S.sort = null; refresh({ cols: true }); };
$('#search').addEventListener('input', e => { S.search = e.target.value; clearTimeout(S.st); S.st = setTimeout(() => { computeView(); clampSel(); renderBody(); }, 180); });
$('#stFilter').addEventListener('change', () => { computeView(); clampSel(); renderBody(); });

/* ---------- экспорт таблиц ---------- */
async function exportDialog(kind) {
  const html = `<div class="f"><label>Строки</label><select id="exRows"><option value="all">все (${S.lib.rows.length})</option><option value="view">отфильтрованные (${S.view.length})</option><option value="chk" ${S.checked.size ? '' : 'disabled'}>отмеченные (${S.checked.size})</option></select>
    <label>Столбцы</label><select id="exCols"><option value="all">все, включая скрытые</option><option value="vis">только видимые</option></select></div>
    <p class="muted">Первая строка — ключи столбцов, их не переименовывайте. <b>ID</b> связывает строку с записью. <b>Action</b>: <code>DEL</code> — удалить, <code>NEW</code> — новая запись: ID пустой, в <b>Template</b> — ID или имя донора. В пользовательском поле <code>#DEL</code> удаляет поле. Столбцы корпуса и 3D у компонентов с общим корпусом действуют на все такие компоненты.</p>
    ${kind === 'csv' ? '<p class="muted">CSV: разделитель <code>;</code>, UTF-8 с BOM. Типы полей (текст/ссылка) в CSV не передаются.</p>' : '<p class="muted">Листы: Записи, Типы_полей (0 — текст, 1 — ссылка), Поля_по_умолчанию, Библиотека, Справка. Все ячейки текстовые.</p>'}`;
  const b = [{ t: 'Отмена', v: 0 }, { t: 'Выгрузить', v: 1, pri: true }]; b.onOpen = bg => S._ex = bg;
  if (await modal(kind === 'csv' ? 'Экспорт CSV' : 'Экспорт в Excel', html, b) !== 1) return;
  const rm = S._ex.querySelector('#exRows').value, cm = S._ex.querySelector('#exCols').value;
  const recs = rm === 'all' ? S.lib.rows : rm === 'view' ? S.view : S.lib.rows.filter(c => S.checked.has(c));
  let cols = DT.tableColumns(S.lib, { template: S.tpl || [] }); const nk = nameKey();
  if (cm === 'vis') { const vis = new Set(S.cols.map(c => c.key)); cols = cols.filter(k => DT.SYS.includes(k) || k === nk || vis.has(k)); }
  const rows = [cols, ...DT.tableRows(S.lib, recs, cols)];
  if (kind === 'csv') { download(new Blob([XL.toCSV(rows)], { type: 'text/csv;charset=utf-8' }), baseName() + '_' + stamp() + '.csv'); return; }
  const types = [cols, ...DT.typeRows(S.lib, recs, cols)].map(r => r.filter((_, j) => cols[j] === 'ID' || cols[j] === nk || DT.isUF(cols[j])));
  types.slice(1).forEach((r, i) => r[1] = rowName(recs[i]));
  const widths = cols.map(k => k === 'ID' ? 7 : k === 'Action' || k === 'Template' ? 9 : k === nk ? 28 : ['Datasheet', 'PatDescription', 'M3Var', 'M3Path', 'Category', 'PatCategory'].includes(k) ? 40 : DT.isUF(k) ? 18 : 16);
  const roIdx = new Set(cols.map((k, j) => (DT.FMAP[k] && DT.FMAP[k].ro) || k === 'ID' ? j : -1).filter(j => j >= 0));
  const lib = S.lib;
  const libRows = [['Параметр', 'Значение'], ['Name', lib.name], ['Hint', lib.hint], ...lib.subfolders.map(s => ['Subfolder', s]), ['SourceFile', S.E.name], ['Format', lib.type + ' ' + lib.version], ['Records', String(lib.rows.length)], ['Exported', new Date().toLocaleString('ru-RU')]];
  const tplRows = [['Поле', 'Тип (0 — текст, 1 — ссылка)', 'Значение по умолчанию', 'Область (C — компонент, P — корпус, CP — оба)'], ...(S.tpl || []).map(f => [f.n, String(f.t), f.v, f.scope])];
  const help = [['Справка по обмену таблицей'], [''], ['Лист «Записи»: одна строка — один компонент (.elixml) или корпус (.libxml). Первая строка — ключи столбцов, не переименовывайте их.'], ['ID — номер записи в загруженной библиотеке. По нему строка связывается с записью при импорте.'], ['Action: DEL — удалить; NEW — новая запись (ID пустой, в Template — ID или имя донора).'], ['UF:имя — пользовательские поля компонента, PUF:имя — поля корпуса. #DEL удаляет поле.'], ['M3Type — File / IPC-7351 / Outline; M3Var — путь с переменной (%my3dmodels%\\...), M3Path — полный путь; M3Rot/M3Off/M3Zoom — X;Y;Z.'], ['Серые столбцы только для чтения.'], ['Лист «Типы_полей»: 0 — текст, 1 — ссылка; пусто — поле отсутствует.'], ['Лист «Библиотека»: Name, Hint и список Subfolder.']];
  const blob = await XL.writeXlsx([
    { name: 'Записи', rows, opts: { headerRows: 1, autoFilter: true, freezeRows: 1, freezeCols: Math.min(4, cols.indexOf(nk) + 1), textStyle: true, widths, tabSelected: true, cellStyle: (ri, ci) => roIdx.has(ci) ? 3 : (recs[ri - 1] && recs[ri - 1].status === 'new' ? 4 : 2), validations: [{ ref: `B2:B${rows.length + 2000}`, list: 'DEL,NEW' }] } },
    { name: 'Типы_полей', rows: types, opts: { headerRows: 1, freezeRows: 1, freezeCols: 2, textStyle: true, widths: types[0].map((k, j) => j === 1 ? 28 : j === 0 ? 7 : 14) } },
    { name: 'Поля_по_умолчанию', rows: tplRows, opts: { headerRows: 1, textStyle: true, widths: [24, 16, 40, 22] } },
    { name: 'Библиотека', rows: libRows, opts: { headerRows: 1, textStyle: true, widths: [16, 60] } },
    { name: 'Справка', rows: help, opts: { headerRows: 1, widths: [140] } }]);
  download(blob, baseName() + '_' + stamp() + '.xlsx');
}
$('#bXlsx').onclick = () => exportDialog('xlsx');
$('#bCsv').onclick = () => exportDialog('csv');

/* ---------- импорт таблицы ---------- */
$('#bImp').onclick = () => $('#fTab').click();
$('#fTab').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importTableFile(f); });
async function importTableFile(f) {
  let sheets;
  try {
    if (/\.xlsx$/i.test(f.name)) sheets = await XL.readXlsx(new Uint8Array(await f.arrayBuffer()));
    else { const text = FSX.decode(new Uint8Array(await f.arrayBuffer())).replace(/^\ufeff/, ''); sheets = { 'Записи': XL.parseCSV(text) }; }
  } catch (er) { toast('Не удалось прочитать таблицу: ' + er.message, 5000); return; }
  const names = Object.keys(sheets); const main = sheets['Записи'] || sheets['Компоненты'] || sheets[names.find(n => (sheets[n][0] || []).includes('ID'))] || sheets[names[0]];
  const types = sheets['Типы_полей'], tpl = sheets['Поля_по_умолчанию'], libS = sheets['Библиотека'];
  const libInfo = libS ? Object.fromEntries(libS.slice(1).filter(r => r[0] && r[0] !== 'Subfolder').map(r => [r[0], r[1]])) : {};
  const warnSrc = libInfo.SourceFile && libInfo.SourceFile !== S.E.name ? `<p class="warn">Таблица выгружена из «${esc(libInfo.SourceFile)}», а открыта «${esc(S.E.name)}». ID могут не совпасть.</p>` : '';
  const html = `${warnSrc}<p>Строк данных: <b>${Math.max(0, main.length - 1)}</b>, столбцов: <b>${(main[0] || []).length}</b>${types ? ', есть лист типов полей' : ''}.</p>
    <label><input type="checkbox" id="imKeep"> пустые ячейки не затирают существующие значения</label><br>
    <label><input type="checkbox" id="imTypes" ${types ? 'checked' : 'disabled'}> применить лист «Типы_полей»</label><br>
    <label><input type="checkbox" id="imTpl" ${tpl && tpl.length > 1 ? '' : 'disabled'}> загрузить набор «Поля по умолчанию» из книги (${tpl ? Math.max(0, tpl.length - 1) : 0} полей)</label><br>
    <label><input type="checkbox" id="imLib" ${libS ? 'checked' : 'disabled'}> применить лист «Библиотека» (имя, описание, подпапки)</label>
    <p class="muted">Импорт выполняется одной операцией и отменяется кнопкой ↶.</p>`;
  const b = [{ t: 'Отмена', v: 0 }, { t: 'Импортировать', v: 1, pri: true }]; b.onOpen = bg => S._im = bg;
  if (await modal('Импорт таблицы: ' + f.name, html, b) !== 1) return;
  const q = s => S._im.querySelector(s).checked;
  if (q('#imTpl')) { S.tpl = tpl.slice(1).filter(r => r[0]).map(r => ({ n: DT.clean(r[0]), t: +r[1] ? 1 : 0, v: r[2] || '', scope: ['C', 'P', 'CP'].includes((r[3] || '').toUpperCase()) ? r[3].toUpperCase() : 'C' })); saveTpl(); }
  const lib = S.lib; const libBefore = { name: lib.name, hint: lib.hint, subfolders: [...lib.subfolders] };
  if (q('#imLib')) { if (libInfo.Name != null) lib.name = DT.clean(libInfo.Name); if (libInfo.Hint != null) lib.hint = DT.clean(libInfo.Hint); const sf = libS.slice(1).filter(r => r[0] === 'Subfolder' && r[1]).map(r => DT.clean(r[1])); if (sf.length) { const used = lib.rows.map(c => c.d.Subfolder).filter(Boolean); lib.subfolders = [...new Set([...sf, ...used.filter(u => !sf.includes(u))])]; } }
  const rep = DT.importTable(lib, main, { types: q('#imTypes') ? types : null, keepOnEmpty: q('#imKeep'), template: S.tpl || [] });
  if (rep.tx) { rep.tx.libBefore = libBefore; if (!rep.committed && JSON.stringify(libBefore) !== JSON.stringify({ name: lib.name, hint: lib.hint, subfolders: lib.subfolders })) { lib.history.push(rep.tx); lib.redo = []; rep.committed = true; } }
  refresh({ cols: true });
  await modal('Результат импорта', `<p>Изменено записей: <b>${rep.changed}</b> (ячеек: ${rep.cells}), создано: <b>${rep.created}</b>, помечено на удаление: <b>${rep.deleted}</b>${rep.restored ? ', восстановлено: ' + rep.restored : ''}.</p>
    ${rep.unknownCols.length ? `<p class="warn">Проигнорированы неизвестные столбцы: ${rep.unknownCols.map(esc).join(', ')}</p>` : ''}
    ${rep.errors.length ? `<p class="err">Ошибки (${rep.errors.length}):</p><div style="max-height:260px;overflow:auto">${rep.errors.map(x => `<div class="msg">${esc(x)}</div>`).join('')}</div>` : '<p class="ok">Ошибок нет.</p>'}
    ${rep.warnings.length ? `<p class="muted">${[...new Set(rep.warnings)].map(esc).join('<br>')}</p>` : ''}`);
}
