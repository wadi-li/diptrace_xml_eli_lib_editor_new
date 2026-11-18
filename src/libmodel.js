/* Модель библиотек DipTrace XML (.elixml — компоненты, .libxml — корпуса) для табличной правки */
const DT = (() => {
  'use strict';
  const { parse, kid, kids, attr, txt, ktxt, Ed, setText, insertOrdered, encT, leaf } = XT;

  const PART_ORDER = ['Pattern', 'Name', 'PartName', 'Value', 'LibPath', 'Origin', 'Datasheet', 'SpiceModel', 'Manufacturer', 'Category', 'Suppliers', 'Pins', 'Shapes', 'Groups', 'AddFields', 'InternalConnections'];
  const PAT_ORDER = ['Name', 'Name_Description', 'Name_Unique', 'Value', 'Manufacturer', 'Datasheet', 'PossibleNames', 'Category', 'Origin', 'RecoveryCode', 'Groups', 'AddFields', 'Suppliers', 'DefPad', 'Pads', 'Shapes', 'Holes', 'Dimensions', 'Model3D'];
  const SUP_ORDER = ['PartNumber', 'Manufacturer', 'Pattern', 'Supplier', 'Currency'];
  const M3_ORDER = ['Filename', 'Rotate', 'Offset', 'Zoom'];

  /* s: C — компонент (первая секция), P — корпус, M — 3D-модель корпуса; lib: e — только .elixml, l — только .libxml */
  const FIELDS = [
    { key: 'Name', label: 'Имя компонента', g: 'svc', s: 'C' },
    { key: 'RefDes', label: 'Позиционное обозначение (префикс)', g: 'svc', s: 'C' },
    { key: 'Value', label: 'Значение (Value)', g: 'svc', s: 'C' },
    { key: 'Manufacturer', label: 'Производитель', g: 'svc', s: 'C' },
    { key: 'Datasheet', label: 'Datasheet', g: 'svc', s: 'C' },
    { key: 'Subfolder', label: 'Подпапка библиотеки (SubFolders)', g: 'svc', s: 'C' },
    { key: 'Category', label: 'Категория компонента (только чтение; копируется из донора)', g: 'svc', s: 'C', ro: true },
    { key: 'Parts', label: 'Секции (только чтение)', g: 'svc', s: 'C', ro: true },
    { key: 'SupPartNumber', label: 'Поставщик: Part Number', g: 'sup', s: 'C', sup: 'PartNumber' },
    { key: 'SupManufacturer', label: 'Поставщик: производитель', g: 'sup', s: 'C', sup: 'Manufacturer' },
    { key: 'SupPattern', label: 'Поставщик: корпус', g: 'sup', s: 'C', sup: 'Pattern' },
    { key: 'Supplier', label: 'Поставщик', g: 'sup', s: 'C', sup: 'Supplier' },
    { key: 'SupCurrency', label: 'Поставщик: валюта', g: 'sup', s: 'C', sup: 'Currency' },
    { key: 'Pattern', label: 'Имя корпуса (Pattern)', g: 'pat', s: 'P', leaf: 'Name' },
    { key: 'PatUsers', label: 'Сколько компонентов используют корпус (только чтение)', g: 'pat', s: 'P', ro: true, lib: 'e' },
    { key: 'PatRefDes', label: 'Корпус: префикс RefDes', g: 'pat', s: 'P', lib: 'l' },
    { key: 'PatValue', label: 'Корпус: Value', g: 'pat', s: 'P', leaf: 'Value', lib: 'l' },
    { key: 'PatManufacturer', label: 'Корпус: производитель', g: 'pat', s: 'P', leaf: 'Manufacturer' },
    { key: 'PatDatasheet', label: 'Корпус: Datasheet', g: 'pat', s: 'P', leaf: 'Datasheet', lib: 'l' },
    { key: 'PatDescription', label: 'Корпус: описание (Name_Description)', g: 'pat', s: 'P', leaf: 'Name_Description' },
    { key: 'PatUnique', label: 'Корпус: уникальное имя (Name_Unique)', g: 'pat', s: 'P', leaf: 'Name_Unique' },
    { key: 'PatPossibleNames', label: 'Корпус: альтернативные имена (через « | »)', g: 'pat', s: 'P' },
    { key: 'PatCategory', label: 'Категория корпуса (только чтение)', g: 'pat', s: 'P', ro: true },
    { key: 'Mounting', label: 'Монтаж (только чтение)', g: 'pat', s: 'P', ro: true },
    { key: 'PadsN', label: 'Число площадок (только чтение)', g: 'pat', s: 'P', ro: true },
    { key: 'M3Type', label: '3D: источник модели — File / IPC-7351 / Outline', g: 'm3', s: 'M' },
    { key: 'M3Var', label: '3D: путь с переменной (%my3dmodels%…)', g: 'm3', s: 'M' },
    { key: 'M3Path', label: '3D: полный путь к файлу', g: 'm3', s: 'M' },
    { key: 'M3Status', label: '3D: наличие файла в подключённых папках (только чтение)', g: 'm3', s: 'M', ro: true, virt: true },
    { key: 'M3Rot', label: '3D: поворот X;Y;Z, градусы', g: 'm3', s: 'M', xyz: 'Rotate' },
    { key: 'M3Off', label: '3D: смещение X;Y;Z, единицы файла', g: 'm3', s: 'M', xyz: 'Offset' },
    { key: 'M3Zoom', label: '3D: масштаб X;Y;Z', g: 'm3', s: 'M', xyz: 'Zoom' }
  ];
  const FMAP = Object.fromEntries(FIELDS.map(f => [f.key, f]));
  const PNS = ' | ';
  const clean = v => String(v == null ? '' : v).replace(/\r\n|\r|\n|\t/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const isUF = key => key.startsWith('UF:') || key.startsWith('PUF:');
  const ufName = key => key.slice(key.indexOf(':') + 1);
  const isPatKey = key => key.startsWith('PUF:') || (FMAP[key] && FMAP[key].s !== 'C');
  // внешняя проверка наличия файла 3D-модели (подключается из приложения)
  let modelStatus = () => '';
  function setModelStatus(fn) { modelStatus = fn; }

  /* ---------- Чтение ---------- */
  function catText(src, n) {
    if (!n) return '';
    const name = ktxt(src, n, 'Name'); const ct = kid(n, 'CategoryTypes'); const types = [];
    for (const t of kids(ct, 'CategoryType')) { const a = ktxt(src, t, 'Type'), b = ktxt(src, t, 'SubType'); if (a) types.push(b ? a + ' / ' + b : a); }
    return name ? name + (types.length ? ': ' + [...new Set(types)].join('; ') : '') : (types.join('; '));
  }
  function readUF(src, block) {
    return kids(block, 'AddField').map(x => ({ n: ktxt(src, x, 'Name'), v: ktxt(src, x, 'Text'), t: (attr(x, 'Type') || 'Text') === 'Link' ? 1 : 0, node: x })).map(f => { const o = { n: f.n, v: f.v, t: f.t }; Object.defineProperty(o, 'node', { value: f.node, enumerable: false, writable: true }); return o; });
  }
  const xyz = n => n ? [attr(n, 'X') || '0', attr(n, 'Y') || '0', attr(n, 'Z') || '0'].join(';') : '';
  function readPattern(lib, node) {
    const src = lib.src, d = {};
    d.Pattern = ktxt(src, node, 'Name');
    for (const f of FIELDS) if (f.s === 'P' && f.leaf && f.key !== 'Pattern') d[f.key] = ktxt(src, node, f.leaf);
    d.PatRefDes = attr(node, 'RefDes') || '';
    const pn = kid(node, 'PossibleNames'); d.PatPossibleNames = kids(pn, 'PossibleName').map(x => txt(src, x)).join(PNS);
    d.PatCategory = catText(src, kid(node, 'Category'));
    d.Mounting = attr(node, 'Mounting') || '';
    const pads = kid(node, 'Pads'); d.PadsN = pads ? String(countTag(src, pads, '<Pad ')) : '0';
    const M = kid(node, 'Model3D'), F = kid(M, 'Filename');
    d.M3Type = M ? attr(M, 'Type') || '' : '';
    d.M3Path = F ? ktxt(src, F, 'Path') : ''; d.M3Var = F ? ktxt(src, F, 'Var') : '';
    d.M3Rot = xyz(kid(M, 'Rotate')); d.M3Off = xyz(kid(M, 'Offset')); d.M3Zoom = xyz(kid(M, 'Zoom'));
    const rec = { kind: 'pat', node, d, uf: readUF(src, kid(node, 'AddFields')), status: 'orig', cat: null, style: attr(node, 'PatternStyle') || '', users: 0 };
    rec.p = rec; return rec;
  }
  function countTag(src, n, needle) { let c = 0, i = n.cs; for (;;) { i = src.indexOf(needle, i); if (i < 0 || i >= n.ce) return c; c++; i += needle.length; } }
  function readComp(lib, node) {
    const src = lib.src, parts = kids(node, 'Part'), P = parts[0], d = {};
    d.Name = ktxt(src, P, 'Name'); d.RefDes = attr(P, 'RefDes') || '';
    d.Value = ktxt(src, P, 'Value'); d.Manufacturer = ktxt(src, P, 'Manufacturer'); d.Datasheet = ktxt(src, P, 'Datasheet');
    const si = attr(P, 'SubFolderIndex'); const idx = si != null ? +si : -1;
    d.Subfolder = idx >= 0 && lib.subfolders[idx] != null ? lib.subfolders[idx] : '';
    d.Category = catText(src, kid(P, 'Category'));
    d.Parts = parts.length > 1 ? parts.length + ': ' + parts.map(p => ktxt(src, p, 'PartName')).join(', ') : '1';
    const S = kid(P, 'Suppliers'); for (const f of FIELDS) if (f.sup) d[f.key] = S ? ktxt(src, S, f.sup) : '';
    const pt = kid(P, 'Pattern'); const style = pt ? (attr(pt, 'Style') || attr(pt, 'PatternType') || '') : '';
    const p = style ? lib.styles.get(style) || null : null; if (p) p.users++;
    return { kind: 'comp', node, parts, part1: P, d, uf: readUF(src, kid(P, 'AddFields')), p, style, status: 'orig', cat: null, sfDangling: idx >= 0 && lib.subfolders[idx] == null ? idx : null };
  }
  function snapshot(x) { return { d: { ...x.d }, uf: x.uf.map(cpUF), status: x.status, cat: x.cat }; }
  function cpUF(f) { const o = { n: f.n, v: f.v, t: f.t }; if (f.node) Object.defineProperty(o, 'node', { value: f.node, enumerable: false, writable: true }); return o; }
  function restore(x, s) { x.d = { ...s.d }; x.uf = s.uf.map(cpUF); x.status = s.status; x.cat = s.cat; }

  function load(src, info = {}) {
    const nl = src.includes('\r\n') ? '\r\n' : '\n';
    const root = parse(src, 0, src.length, XT.SKIP_LIB);
    const top = root.ch.filter(n => n.t !== '#text');
    if (top.some(n => n.t === 'Source')) throw new Error('Это файл проекта (схема или плата). Проекты загружаются на вкладке «Кросс-проверка».');
    const L = top.find(n => n.t === 'Library');
    if (!L) throw new Error('Не найден корневой элемент <Library> DipTrace XML');
    const type = attr(L, 'Type') || '';
    const lib = { src, nl, root, L, info, type, kind: type === 'DipTrace-ComponentLibrary' ? 'e' : type === 'DipTrace-PatternLibrary' ? 'l' : '', rows: [], pats: [], styles: new Map(), history: [], redo: [] };
    if (!lib.kind) throw new Error('Неизвестный тип библиотеки: ' + type + '. Ожидается DipTrace-ComponentLibrary (.elixml) или DipTrace-PatternLibrary (.libxml)');
    lib.version = attr(L, 'Version') || ''; lib.units = attr(L, 'Units') || 'mm';
    lib.name = attr(L, 'Name') || ''; lib.hint = attr(L, 'Hint') || '';
    lib.hasNameAttr = L.a.some(x => x[0] === 'Name');
    lib.sfNode = kid(L, 'SubFolders'); lib.subfolders = kids(lib.sfNode, 'Item').map(x => txt(src, x));
    lib.orig = { name: lib.name, hint: lib.hint, subfolders: [...lib.subfolders] };
    const PL = lib.kind === 'e' ? kid(L, 'Library') : L;
    lib.PL = PL; lib.PS = kid(PL, 'Patterns');
    for (const n of kids(lib.PS, 'Pattern')) { const p = readPattern(lib, n); p.o = snapshot(p); lib.pats.push(p); if (p.style) lib.styles.set(p.style, p); }
    if (lib.kind === 'e') {
      lib.CS = kid(L, 'Components');
      if (!lib.CS) throw new Error('Нет блока <Components>');
      for (const n of kids(lib.CS, 'Component')) { if (!kids(n, 'Part').length) continue; const c = readComp(lib, n); lib.rows.push(c); }
      for (const p of lib.pats) { p.d.PatUsers = String(p.users); p.o.d.PatUsers = p.d.PatUsers; }
    } else lib.rows = [...lib.pats];
    lib.rows.forEach((r, i) => { r.id = i + 1; r.o = r.o || snapshot(r); });
    lib.nextId = lib.rows.length + 1;
    lib.hasSub = !!lib.sfNode || lib.rows.some(r => r.kind === 'comp' && attr(r.part1, 'SubFolderIndex') != null);
    return lib;
  }

  /* ---------- Значения ---------- */
  function target(r, key) { if (isPatKey(key)) return r.p || null; return r.kind === 'comp' ? r : null; }
  function getVal(r, key) {
    const t = target(r, key); if (!t) return undefined;
    if (isUF(key)) { const f = t.uf.find(x => x.n === ufName(key)); return f ? f.v : undefined; }
    if (key === 'M3Status') return modelStatus(t);
    if (key === 'Category' && r.cat != null) return '← из #' + r.cat;
    if (key === 'PatCategory' && t.cat != null) return '← из #' + t.cat;
    return t.d[key];
  }
  function getType(r, key) { const t = target(r, key); if (!t) return undefined; const f = t.uf.find(x => x.n === ufName(key)); return f ? f.t : undefined; }
  function fieldAvail(lib, key) { const f = FMAP[key]; if (!f) return isUF(key) ? (lib.kind === 'l' ? key.startsWith('PUF:') : true) : false; if (f.lib && f.lib !== lib.kind) return false; if (lib.kind === 'l' && f.s === 'C') return false; if (key === 'Subfolder' && !lib.hasSub) return false; return true; }
  function isRO(key, r) {
    const t = r ? target(r, key) : true; if (r && !t) return true;
    if (isUF(key)) return false;
    const f = FMAP[key]; if (!f) return true; return !!f.ro;
  }
  const NUMRE = /^-?\d+(?:[.,]\d+)?(?:e-?\d+)?$/i;
  function normVal(key, v) {
    v = clean(v);
    const f = FMAP[key];
    if (f && f.xyz) {
      const p = v.split(/[;\s]+/).filter(Boolean).map(x => x.replace(',', '.'));
      if (!p.length) return key === 'M3Zoom' ? '1;1;1' : '0;0;0';
      while (p.length < 3) p.push(key === 'M3Zoom' ? p[0] || '1' : '0');
      return p.slice(0, 3).map(x => NUMRE.test(x) ? String(+x) : '0').join(';');
    }
    if (key === 'M3Type') { const u = v.trim().toLowerCase(); return u.startsWith('ipc') ? 'IPC-7351' : u.startsWith('out') ? 'Outline' : u === '' ? '' : 'File'; }
    if (key === 'PatPossibleNames') return v.split('|').map(s => s.trim()).filter(Boolean).join(PNS);
    return v;
  }
  function setVal(r, key, v, opt = {}) {
    if (isRO(key, r)) return false;
    const t = target(r, key);
    if (isUF(key)) {
      const n = ufName(key), f = t.uf.find(x => x.n === n);
      if (v === null || v === '#DEL') { if (!f) return false; t.uf.splice(t.uf.indexOf(f), 1); return true; }
      v = clean(v);
      if (!f) { if (opt.noCreate) return false; t.uf.push({ n, v, t: opt.type != null ? opt.type : 0 }); return true; }
      if (f.v === v && (opt.type == null || f.t === opt.type)) return false;
      f.v = v; if (opt.type != null) f.t = opt.type; return true;
    }
    v = normVal(key, v);
    if (t.d[key] === v) return false;
    t.d[key] = v;
    // путь и путь с переменной ссылаются на один файл — поменяли один, второй сбрасывать не будем, но пометим
    return true;
  }
  function setType(r, key, ty) { const t = target(r, key); if (!t) return false; const f = t.uf.find(x => x.n === ufName(key)); if (!f || f.t === ty) return false; f.t = ty; return true; }
  function objChanged(x) {
    if (!x || !x.o) return false;
    if (x.status !== 'orig' || x.cat != null) return true;
    for (const k in x.d) if (x.d[k] !== x.o.d[k]) return true;
    return JSON.stringify(x.uf) !== JSON.stringify(x.o.uf);
  }
  function compChanged(r) { return objChanged(r) || (r.p && r.p !== r && objChanged(r.p)); }
  function isChanged(r, key) {
    const t = target(r, key); if (!t) return false;
    if (t.status === 'new') return true;
    if (isUF(key)) {
      const a = t.uf.find(x => x.n === ufName(key)), b = t.o.uf.find(x => x.n === ufName(key));
      if (!a && !b) return false; if (!a || !b) return true; return a.v !== b.v || a.t !== b.t;
    }
    if (key === 'Category') return r.cat != null;
    if (key === 'PatCategory') return t.cat != null;
    return t.d[key] !== t.o.d[key];
  }
  function diffObj(x, label) {
    const out = [];
    for (const f of FIELDS) if (!f.ro && !f.virt && x.d[f.key] !== undefined && x.d[f.key] !== x.o.d[f.key]) out.push({ f: (label || '') + f.key, a: x.o.d[f.key], b: x.d[f.key] });
    if (x.cat != null) out.push({ f: (label || '') + 'Category', a: '', b: 'из #' + x.cat });
    const pre = x.kind === 'pat' ? 'PUF:' : 'UF:', cur = x.uf, old = x.o.uf;
    const names = [...new Set([...old.map(f => f.n), ...cur.map(f => f.n)])];
    for (const n of names) {
      const a = old.find(f => f.n === n), b = cur.find(f => f.n === n);
      if (!a) out.push({ f: pre + n, a: '(нет)', b: b.v + (b.t ? ' [ссылка]' : '') });
      else if (!b) out.push({ f: pre + n, a: a.v, b: '(удалено)' });
      else if (a.v !== b.v || a.t !== b.t) out.push({ f: pre + n, a: a.v + (a.t ? ' [ссылка]' : ''), b: b.v + (b.t ? ' [ссылка]' : '') });
    }
    const oo = old.map(f => f.n).filter(n => cur.some(y => y.n === n)).join('\u0001'), co = cur.map(f => f.n).filter(n => old.some(y => y.n === n)).join('\u0001');
    if (oo !== co) out.push({ f: pre + '(порядок)', a: '', b: 'изменён' });
    return out;
  }
  function diffComp(r) {
    const out = [];
    if (r.status === 'new') out.push({ f: '(запись)', a: '', b: 'создана из #' + r.src });
    if (r.status === 'del') { out.push({ f: '(запись)', a: '', b: 'удалена' }); return out; }
    out.push(...diffObj(r));
    if (r.p && r.p !== r && objChanged(r.p)) out.push(...diffObj(r.p, '').map(x => ({ ...x, f: 'корпус «' + r.p.d.Pattern + '»: ' + x.f })));
    return out;
  }
  function expand(tpl, r) {
    return String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => {
      if (k === '#' || k === 'ID') return String(r.id);
      const v = getVal(r, k); return v === undefined ? '' : v;
    });
  }

  /* ---------- История ---------- */
  function libState(lib) { return { name: lib.name, hint: lib.hint, subfolders: [...lib.subfolders] }; }
  function begin(lib, label) { return { label, items: new Map(), created: [], libBefore: libState(lib) }; }
  function touch(tx, r) { for (const x of [r, r.p]) if (x && !tx.items.has(x)) tx.items.set(x, snapshot(x)); }
  function commit(lib, tx) {
    let changed = tx.created.length > 0 || JSON.stringify(libState(lib)) !== JSON.stringify(tx.libBefore);
    if (!changed) for (const [x, s] of tx.items) if (JSON.stringify(snapshot(x)) !== JSON.stringify(s)) { changed = true; break; }
    if (!changed) return false;
    lib.history.push(tx); if (lib.history.length > 150) lib.history.shift(); lib.redo = [];
    return true;
  }
  function swap(lib, tx) {
    const inv = { label: tx.label, items: new Map(), created: tx.created, libBefore: libState(lib), removed: !tx.removed };
    for (const [x, s] of tx.items) { inv.items.set(x, snapshot(x)); restore(x, s); }
    if (tx.created.length) {
      if (!tx.removed) { lib.rows = lib.rows.filter(r => !tx.created.includes(r)); if (lib.kind === 'l') lib.pats = lib.rows; }
      else for (const r of tx.created) insertRow(lib, r);
    }
    Object.assign(lib, { name: tx.libBefore.name, hint: tx.libBefore.hint, subfolders: [...tx.libBefore.subfolders] });
    return inv;
  }
  function undo(lib) { const tx = lib.history.pop(); if (!tx) return null; lib.redo.push(swap(lib, tx)); return tx.label; }
  function redoOp(lib) { const tx = lib.redo.pop(); if (!tx) return null; lib.history.push(swap(lib, tx)); return tx.label; }

  /* ---------- Создание ---------- */
  function insertRow(lib, r) {
    const i = lib.rows.findIndex(x => x.id === r.after);
    let j = i; while (j + 1 < lib.rows.length && lib.rows[j + 1].status === 'new' && lib.rows[j + 1].after === r.after) j++;
    lib.rows.splice(j < 0 ? lib.rows.length : j + 1, 0, r);
  }
  function cloneRow(lib, src, tx) {
    const r = { kind: src.kind, node: src.node, parts: src.parts, part1: src.part1, style: src.style, users: 0, status: 'new', src: src.id, after: src.id, id: lib.nextId++, cat: src.cat, sfDangling: null };
    restore(r, snapshot(src)); r.status = 'new';
    r.o = { ...src.o, d: { ...src.o.d }, uf: src.o.uf.map(cpUF), status: 'new' };
    r.p = src.kind === 'pat' ? r : src.p;
    insertRow(lib, r);
    if (tx) tx.created.push(r);
    return r;
  }
  function uniqueName(lib, base) {
    const key = lib.kind === 'e' ? 'Name' : 'Pattern';
    const names = new Set(lib.rows.map(r => r.d[key])); if (!names.has(base)) return base;
    for (let i = 2; ; i++) { const n = base + '_' + i; if (!names.has(n)) return n; }
  }

  /* ---------- Запись ---------- */
  function ufXml(lib, f, ed) {
    const src = lib.src, nl = lib.nl;
    if (f.node) {
      const n = f.node, o = { n: ktxt(src, n, 'Name'), v: ktxt(src, n, 'Text'), t: (attr(n, 'Type') || 'Text') === 'Link' ? 1 : 0 };
      if (o.n === f.n && o.v === f.v && o.t === f.t) return XT.raw(src, n);
      const e = new Ed(src, nl);
      if (o.t !== f.t) e.setAttr(n, 'Type', f.t ? 'Link' : 'Text');
      if (o.n !== f.n) setText(e, n, 'Name', f.n, ['Name', 'Text']);
      if (o.v !== f.v) setText(e, n, 'Text', f.v, ['Name', 'Text']);
      return e.render(n.s, n.e);
    }
    return `<AddField Type="${f.t ? 'Link' : 'Text'}">${nl}${leaf('Name', f.n)}${nl}${leaf('Text', f.v)}${nl}</AddField>`;
  }
  function writeUF(lib, ed, owner, list, order) {
    const blk = kid(owner, 'AddFields');
    if (!list.length) { if (blk) ed.remove(blk); return; }
    const nl = lib.nl, str = '<AddFields>' + nl + list.map(f => ufXml(lib, f, ed)).join(nl) + nl + '</AddFields>';
    if (blk) ed.replace(blk, str); else insertOrdered(ed, owner, 'AddFields', str, order);
  }
  function catDonor(lib, id) { return lib.rows.find(x => x.id === id); }
  function applyComp(lib, ed, r) {
    const P = r.part1, d = r.d, o = r.o.d, src = lib.src;
    const ch = k => d[k] !== o[k];
    if (ch('Name')) setText(ed, P, 'Name', d.Name, PART_ORDER);
    if (ch('RefDes')) ed.setAttr(P, 'RefDes', d.RefDes);
    if (ch('Value')) { let done = false; for (const p of r.parts) if (kid(p, 'Value')) { setText(ed, p, 'Value', d.Value, PART_ORDER); done = true; } if (!done) setText(ed, P, 'Value', d.Value, PART_ORDER); }
    if (ch('Manufacturer')) setText(ed, P, 'Manufacturer', d.Manufacturer, PART_ORDER);
    if (ch('Datasheet')) setText(ed, P, 'Datasheet', d.Datasheet, PART_ORDER);
    if (lib.hasSub) {
      const i = d.Subfolder ? lib.subfolders.indexOf(d.Subfolder) : -1; const cur = attr(P, 'SubFolderIndex');
      if (ch('Subfolder') || (cur != null && d.Subfolder && +cur !== i)) ed.setAttr(P, 'SubFolderIndex', String(i));
    }
    if (FIELDS.some(f => f.sup && ch(f.key))) {
      const S = kid(P, 'Suppliers');
      if (S) { for (const f of FIELDS) if (f.sup && ch(f.key)) setText(ed, S, f.sup, d[f.key], SUP_ORDER, { removeEmpty: true }); }
      else { const inner = FIELDS.filter(f => f.sup && d[f.key]).map(f => leaf(f.sup, d[f.key])); if (inner.length) insertOrdered(ed, P, 'Suppliers', '<Suppliers>' + lib.nl + inner.join(lib.nl) + lib.nl + '</Suppliers>', PART_ORDER); }
    }
    if (JSON.stringify(r.uf) !== JSON.stringify(r.o.uf)) writeUF(lib, ed, P, r.uf, PART_ORDER);
    if (r.cat != null) { const dn = catDonor(lib, r.cat); const dc = dn && kid(dn.part1, 'Category'); const mine = kid(P, 'Category'); if (dc) { const s = XT.raw(src, dc); if (mine) ed.replace(mine, s); else insertOrdered(ed, P, 'Category', s, PART_ORDER); } }
  }
  function applyPat(lib, ed, p) {
    const N = p.node, d = p.d, o = p.o.d, src = lib.src, nl = lib.nl;
    const ch = k => d[k] !== o[k];
    for (const f of FIELDS) if (f.s === 'P' && f.leaf && ch(f.key)) setText(ed, N, f.leaf, d[f.key], PAT_ORDER, { removeEmpty: f.key !== 'Pattern' });
    if (ch('PatRefDes')) ed.setAttr(N, 'RefDes', d.PatRefDes || null);
    if (ch('PatPossibleNames')) {
      const list = d.PatPossibleNames.split('|').map(s => s.trim()).filter(Boolean); const pn = kid(N, 'PossibleNames');
      const str = '<PossibleNames>' + nl + list.map(s => leaf('PossibleName', s)).join(nl) + nl + '</PossibleNames>';
      if (!list.length) { if (pn) ed.remove(pn); } else if (pn) ed.replace(pn, str); else insertOrdered(ed, N, 'PossibleNames', str, PAT_ORDER);
    }
    if (JSON.stringify(p.uf) !== JSON.stringify(p.o.uf)) writeUF(lib, ed, N, p.uf, PAT_ORDER);
    if (p.cat != null) { const dn = catDonor(lib, p.cat); const dc = dn && kid(dn.p.node, 'Category'); const mine = kid(N, 'Category'); if (dc) { const s = XT.raw(src, dc); if (mine) ed.replace(mine, s); else insertOrdered(ed, N, 'Category', s, PAT_ORDER); } }
    const m3 = ['M3Type', 'M3Path', 'M3Var', 'M3Rot', 'M3Off', 'M3Zoom'];
    if (m3.some(ch)) {
      const M = kid(N, 'Model3D');
      if (!M) { ed.insertBeforeEnd(N, model3dXml(d, nl)); return; }
      if (ch('M3Type') && d.M3Type) ed.setAttr(M, 'Type', d.M3Type);
      if (ch('M3Path') || ch('M3Var')) {
        const F = kid(M, 'Filename');
        const str = filenameXml(d, nl);
        if (!d.M3Path && !d.M3Var) { if (F) ed.remove(F); }
        else if (F) ed.replace(F, str); else ed.insertInto(M, str);
      }
      for (const [k, tag] of [['M3Rot', 'Rotate'], ['M3Off', 'Offset'], ['M3Zoom', 'Zoom']]) if (ch(k)) {
        const n = kid(M, tag), v = (d[k] || (tag === 'Zoom' ? '1;1;1' : '0;0;0')).split(';');
        if (n) { ed.setAttr(n, 'X', v[0]); ed.setAttr(n, 'Y', v[1]); ed.setAttr(n, 'Z', v[2]); }
        else insertOrdered(ed, M, tag, `<${tag} X="${v[0]}" Y="${v[1]}" Z="${v[2]}" />`, M3_ORDER);
      }
    }
  }
  function filenameXml(d, nl) { return '<Filename>' + nl + leaf('Path', d.M3Path) + nl + leaf('Var', d.M3Var) + nl + '</Filename>'; }
  function model3dXml(d, nl) {
    const v = k => (d[k] || (k === 'M3Zoom' ? '1;1;1' : '0;0;0')).split(';');
    const [r, o, z] = [v('M3Rot'), v('M3Off'), v('M3Zoom')];
    return `<Model3D Mirror="N" NoSearch="N" Units="mm" IPC_XOff="0" IPC_YOff="0" AutoHeight="1" AutoColor="0" Type="${d.M3Type || 'File'}" KeepPins="N">` + nl + (d.M3Path || d.M3Var ? filenameXml(d, nl) + nl : '') +
      `<Rotate X="${r[0]}" Y="${r[1]}" Z="${r[2]}" />${nl}<Offset X="${o[0]}" Y="${o[1]}" Z="${o[2]}" />${nl}<Zoom X="${z[0]}" Y="${z[1]}" Z="${z[2]}" />${nl}</Model3D>`;
  }
  function renderRow(lib, r, idx) {
    const ed = new Ed(lib.src, lib.nl), N = r.node;
    if (idx != null && attr(N, 'Id') !== String(idx)) ed.setAttr(N, 'Id', String(idx));
    if (r.status === 'new') for (const a of ['ComponentStyle', 'PatternStyle']) { const v = attr(N, a); if (v) { lib.styleSeq = lib.styleSeq || {}; const pre = v.replace(/\d+$/, ''); if (lib.styleSeq[pre] == null) { let mx = -1; for (const m of lib.src.matchAll(new RegExp(a + '="' + pre + '(\\d+)"', 'g'))) mx = Math.max(mx, +m[1]); lib.styleSeq[pre] = mx + 1; } if (!r.newStyle) r.newStyle = pre + (lib.styleSeq[pre]++); ed.setAttr(N, a, r.newStyle); } }
    if (r.kind === 'comp') { if (objChanged(r) || r.status === 'new') applyComp(lib, ed, r); }
    else if (objChanged(r) || r.status === 'new') applyPat(lib, ed, r);
    return ed.render(N.s, N.e);
  }
  function isDirty(lib) {
    if (JSON.stringify(libState(lib)) !== JSON.stringify(lib.orig)) return true;
    return lib.rows.some(compChanged) || lib.pats.some(objChanged);
  }
  function build(lib) {
    const src = lib.src, nl = lib.nl, ed = new Ed(src, nl), L = lib.L;
    if (lib.name !== lib.orig.name) ed.setAttr(L, 'Name', lib.name);
    if (lib.hint !== lib.orig.hint) ed.setAttr(L, 'Hint', lib.hint);
    if (JSON.stringify(lib.subfolders) !== JSON.stringify(lib.orig.subfolders)) {
      const str = '<SubFolders>' + nl + lib.subfolders.map(s => leaf('Item', s)).join(nl) + nl + '</SubFolders>';
      if (lib.sfNode) { if (lib.subfolders.length) ed.replace(lib.sfNode, str); else ed.remove(lib.sfNode); }
      else if (lib.subfolders.length) { if (lib.kind === 'e' && lib.PL !== L) ed.insertAfter(lib.PL, str); else ed.insertInto(L, str); }
    }
    const listXml = (tag, items) => items.length ? `<${tag}>` + nl + items.join(nl) + nl + `</${tag}>` : `<${tag}>` + nl + `</${tag}>`;
    if (lib.kind === 'e') {
      for (const p of lib.pats) if (objChanged(p)) ed.replace(p.node, renderRow(lib, p, null));
      const live = lib.rows.filter(r => r.status !== 'del');
      const changedOrder = live.length !== lib.rows.length || lib.rows.some(r => r.status === 'new') || live.some(compChanged);
      if (changedOrder) ed.replace(lib.CS, listXml('Components', live.map((r, i) => renderRow(lib, r, i))));
    } else {
      const live = lib.rows.filter(r => r.status !== 'del');
      if (live.length !== lib.rows.length || live.some(r => objChanged(r))) ed.replace(lib.PS, listXml('Patterns', live.map((r, i) => renderRow(lib, r, i))));
    }
    return ed.render();
  }
  // После сохранения: перечитать файл (смещения меняются)
  function reload(lib, text) { const n = load(text, lib.info); return n; }

  /* ---------- Проверка ---------- */
  function validate(lib) {
    const out = []; const add = (lvl, r, msg) => out.push({ lvl, id: r ? r.id : '', name: r ? (lib.kind === 'e' ? r.d.Name : r.d.Pattern) : '', msg });
    const live = lib.rows.filter(r => r.status !== 'del');
    const nk = lib.kind === 'e' ? 'Name' : 'Pattern';
    const cnt = new Map(); for (const r of live) cnt.set(r.d[nk], (cnt.get(r.d[nk]) || 0) + 1);
    for (const r of live) {
      const nm = r.d[nk];
      if (!nm) add('err', r, lib.kind === 'e' ? 'Пустое имя компонента' : 'Пустое имя корпуса');
      else if (cnt.get(nm) > 1) add('err', r, 'Имя повторяется (' + cnt.get(nm) + ' раз)');
      if (lib.kind === 'e' && !r.d.RefDes) add('warn', r, 'Пустое позиционное обозначение');
      if (lib.kind === 'e' && !r.p) add('info', r, 'Корпус не привязан');
      if (r.d.Subfolder && !lib.subfolders.includes(r.d.Subfolder)) add('err', r, 'Подпапка «' + r.d.Subfolder + '» отсутствует в списке подпапок библиотеки');
      const lists = [['UF:', r.kind === 'comp' ? r.uf : []], ['PUF:', r.p ? r.p.uf : []]];
      for (const [pre, list] of lists) {
        const seen = new Set();
        for (const f of list) {
          if (!f.n.trim()) add('err', r, pre + ' пустое имя пользовательского поля');
          if (seen.has(f.n)) add('warn', r, pre + f.n + ': поле повторяется'); seen.add(f.n);
          if (f.t === 1 && f.v && !/^(https?:|ftp:|file:|mailto:|[a-z]:\\|\\\\|%|\.{0,2}[\\/])/i.test(f.v)) add('info', r, pre + f.n + ': тип «ссылка», но значение не похоже на URL или путь');
        }
      }
      const P = r.p;
      if (P) {
        if (P.d.M3Type === 'File' && !P.d.M3Path && !P.d.M3Var) add('warn', r, '3D: тип File, но путь к модели не задан');
        const st = modelStatus(P);
        if (P.d.M3Type === 'File' && st.startsWith('✗')) add('err', r, '3D: ' + st + ' — ' + (P.d.M3Var || P.d.M3Path));
        for (const k of ['M3Rot', 'M3Off', 'M3Zoom']) if (P.d[k] && P.d[k].split(';').some(x => !isFinite(+x))) add('err', r, '3D: ' + k + ' — нечисловое значение');
      }
      if (r.sfDangling != null && !r.d.Subfolder) add('info', r, 'SubFolderIndex=' + r.sfDangling + ' ссылается на несуществующую подпапку (сохраняется как есть)');
    }
    return out;
  }

  /* ---------- Статистика и шаблон полей ---------- */
  function ufStats(lib, pre) {
    const m = new Map(); const seenP = new Set();
    for (const r of lib.rows) {
      if (r.status === 'del') continue;
      let list;
      if (pre === 'UF:') { if (r.kind !== 'comp') continue; list = r.uf; } else { if (!r.p) continue; list = r.p.uf; }
      for (const f of list) { let s = m.get(f.n); if (!s) m.set(f.n, s = { n: f.n, count: 0, t1: 0 }); s.count++; if (f.t === 1) s.t1++; }
    }
    return [...m.values()].map(s => ({ n: s.n, count: s.count, t: s.t1 * 2 > s.count ? 1 : 0 }));
  }
  function templateFromLib(lib, minShare = 0.5) {
    const live = lib.rows.filter(r => r.status !== 'del').length || 1, out = [];
    for (const [pre, scope] of [['UF:', 'C'], ['PUF:', 'P']]) for (const s of ufStats(lib, pre)) if (s.count / live >= minShare) {
      const e = out.find(x => x.n === s.n);
      if (e) { if (e.scope !== scope) e.scope = 'CP'; } else out.push({ n: s.n, t: s.t, v: '', scope });
    }
    return out;
  }
  function applyTemplate(lib, rows, tpl, op, tx) {
    let n = 0; const done = new Set();
    for (const r of rows) {
      if (r.status === 'del') continue;
      for (const sc of ['C', 'P']) {
        const obj = sc === 'C' ? (r.kind === 'comp' ? r : null) : r.p;
        if (!obj || done.has(obj)) continue; done.add(obj);
        const T = tpl.filter(x => x.n && x.scope.includes(sc)); if (!T.length && op !== 'purge') continue;
        touch(tx, r); const before = JSON.stringify(obj.uf); const L = obj.uf;
        if (op === 'add') for (const f of T) { if (!L.some(x => x.n === f.n)) L.push({ n: f.n, v: f.v ? clean(expand(f.v, r)) : '', t: f.t | 0 }); }
        if (op === 'fill') for (const f of T) { const x = L.find(y => y.n === f.n); if (x && x.v === '' && f.v) x.v = clean(expand(f.v, r)); }
        if (op === 'types') for (const f of T) for (const x of L) if (x.n === f.n) x.t = f.t | 0;
        if (op === 'order') { const inT = L.filter(x => T.some(f => f.n === x.n)).sort((a, b) => T.findIndex(f => f.n === a.n) - T.findIndex(f => f.n === b.n)); const rest = L.filter(x => !T.some(f => f.n === x.n)); obj.uf = [...inT, ...rest]; }
        if (op === 'purge') obj.uf = L.filter(x => x.v !== '' || T.some(f => f.n === x.n));
        if (JSON.stringify(obj.uf) !== before) n++;
      }
    }
    return n;
  }

  /* ---------- Табличный обмен ---------- */
  const SYS = ['ID', 'Action', 'Template'];
  function tableColumns(lib, opts = {}) {
    const cols = [...SYS, ...FIELDS.filter(f => fieldAvail(lib, f.key) && !f.virt).map(f => f.key)];
    const uf = lib.kind === 'e' ? ufStats(lib, 'UF:').map(s => 'UF:' + s.n) : [], puf = ufStats(lib, 'PUF:').map(s => 'PUF:' + s.n);
    for (const f of opts.template || []) { if (lib.kind === 'e' && f.scope.includes('C') && !uf.includes('UF:' + f.n)) uf.push('UF:' + f.n); if (f.scope.includes('P') && !puf.includes('PUF:' + f.n)) puf.push('PUF:' + f.n); }
    return [...cols, ...uf, ...puf];
  }
  function tableRows(lib, rows, cols) {
    return rows.map(r => cols.map(k => {
      if (k === 'ID') return String(r.id);
      if (k === 'Action') return r.status === 'del' ? 'DEL' : '';
      if (k === 'Template') return r.status === 'new' ? String(r.src) : '';
      const v = getVal(r, k); return v === undefined ? '' : v;
    }));
  }
  function typeRows(lib, rows, cols) { return rows.map(r => cols.map(k => k === 'ID' ? String(r.id) : isUF(k) ? (v => v === undefined ? '' : String(v))(getType(r, k)) : '')); }
  function importTable(lib, rows, opts = {}) {
    const rep = { changed: 0, cells: 0, created: 0, deleted: 0, restored: 0, errors: [], warnings: [], unknownCols: [] };
    if (!rows.length) { rep.errors.push('Пустая таблица'); return rep; }
    const hdr = rows[0].map(h => { h = String(h == null ? '' : h); return isUF(h.trimStart()) ? h.trimStart() : h.trim(); });
    const col = k => hdr.indexOf(k);
    if (col('ID') < 0) { rep.errors.push('Нет столбца ID — таблица должна быть получена экспортом из этого редактора'); return rep; }
    const known = new Set([...SYS, ...FIELDS.map(f => f.key)]);
    hdr.forEach(h => { if (h && !known.has(h) && !isUF(h)) rep.unknownCols.push(h); });
    const typeMap = new Map();
    if (opts.types && opts.types.length > 1) {
      const th = opts.types[0].map(String), ti = th.indexOf('ID');
      for (const r of opts.types.slice(1)) { const id = String(r[ti] || '').trim(); if (!id) continue; const m = {}; th.forEach((h, j) => { if (isUF(h) && r[j] !== '' && r[j] != null) m[h] = +r[j] ? 1 : 0; }); typeMap.set(id, m); }
    }
    const defType = {};
    for (const s of ufStats(lib, 'UF:')) defType['UF:' + s.n] = s.t;
    for (const s of ufStats(lib, 'PUF:')) defType['PUF:' + s.n] = s.t;
    for (const f of opts.template || []) { if (f.scope.includes('C')) defType['UF:' + f.n] = f.t; if (f.scope.includes('P')) defType['PUF:' + f.n] = f.t; }
    const tx = begin(lib, 'Импорт таблицы');
    const nk = lib.kind === 'e' ? 'Name' : 'Pattern';
    const byId = new Map(lib.rows.map(r => [String(r.id), r])), byName = new Map(lib.rows.map(r => [r.d[nk], r]));
    const seen = new Set();
    rows.slice(1).forEach((row, ri) => {
      const line = ri + 2, cell = k => { const j = col(k); return j < 0 ? undefined : (row[j] == null ? '' : String(row[j])); };
      const id = (cell('ID') || '').trim(), act = (cell('Action') || '').trim().toUpperCase(), tplRef = (cell('Template') || '').trim();
      let r;
      if (id) {
        r = byId.get(id);
        if (!r) { rep.errors.push(`Строка ${line}: запись ID=${id} не найдена в загруженной библиотеке`); return; }
        if (seen.has(id)) { rep.errors.push(`Строка ${line}: ID=${id} повторяется, строка пропущена`); return; }
        seen.add(id);
      } else if (act === 'NEW' || tplRef) {
        const donor = byId.get(tplRef) || byName.get(tplRef);
        if (!donor) { rep.errors.push(`Строка ${line}: донор «${tplRef}» (Template: ID или имя) не найден`); return; }
        r = cloneRow(lib, donor, tx); rep.created++; byId.set(String(r.id), r);
      } else { if (row.some(x => String(x).trim())) rep.errors.push(`Строка ${line}: пустой ID и не указан Template — строка пропущена`); return; }
      touch(tx, r);
      if (act === 'DEL') { if (r.status !== 'del') { r.status = 'del'; rep.deleted++; } return; }
      if (r.status === 'del') { r.status = r.o.status === 'new' ? 'new' : 'orig'; rep.restored++; }
      const before = JSON.stringify(snapshot(r)) + (r.p && r.p !== r ? JSON.stringify(snapshot(r.p)) : '');
      const tm = typeMap.get(id) || {};
      hdr.forEach((h, j) => {
        if (!h || SYS.includes(h) || (!isUF(h) && (!FMAP[h] || FMAP[h].ro || !fieldAvail(lib, h)))) return;
        let v = row[j] == null ? '' : String(row[j]);
        if (isUF(h)) {
          if (!target(r, h)) return;
          const cur = getVal(r, h);
          if (v.trim().toUpperCase() === '#DEL') { if (setVal(r, h, null)) rep.cells++; return; }
          if (v === '' && (cur === undefined || opts.keepOnEmpty)) return;
          const t = tm[h] != null ? tm[h] : (cur === undefined ? (defType[h] || 0) : undefined);
          if (setVal(r, h, v, { type: t })) rep.cells++;
        } else {
          if (!target(r, h)) return;
          if (v === '' && opts.keepOnEmpty) return;
          if (setVal(r, h, v)) rep.cells++;
        }
      });
      for (const h in tm) if (getVal(r, h) !== undefined && setType(r, h, tm[h])) rep.cells++;
      if (JSON.stringify(snapshot(r)) + (r.p && r.p !== r ? JSON.stringify(snapshot(r.p)) : '') !== before) rep.changed++;
      if (r.d.Subfolder && !lib.subfolders.includes(r.d.Subfolder)) { lib.subfolders.push(r.d.Subfolder); rep.warnings.push(`Добавлена подпапка «${r.d.Subfolder}»`); }
    });
    if (rows.length > 1 && lib.rows.some(r => r.p && r.p !== r)) {
      const shared = new Set(); for (const r of lib.rows) if (r.p && r.p.users > 1 && objChanged(r.p)) shared.add(r.p.d.Pattern);
      if (shared.size) rep.warnings.push('Изменены общие корпуса (действует на все компоненты с этим корпусом): ' + [...shared].slice(0, 10).join(', ') + (shared.size > 10 ? '…' : ''));
    }
    rep.tx = tx; rep.committed = commit(lib, tx);
    return rep;
  }

  return { load, build, reload, isDirty, FIELDS, FMAP, SYS, PNS, clean, isUF, ufName, isPatKey, fieldAvail, getVal, getType, setVal, setType, isRO, isChanged, compChanged, objChanged, diffComp, expand, begin, touch, commit, undo, redo: redoOp, cloneRow, uniqueName, validate, ufStats, templateFromLib, applyTemplate, tableColumns, tableRows, typeRows, importTable, snapshot, setModelStatus, target, model3dXml };
})();
if (typeof module !== 'undefined') module.exports = DT;
