/* Проекты DipTrace (.dchxml, .dipxml) и кросс-проверка: STEP ↔ корпуса ↔ компоненты ↔ схемы ↔ платы */
const XR = (() => {
  'use strict';
  const { parse, kid, kids, attr, ktxt, txt } = XT;

  function libPathOf(src, n) { const L = kid(n, 'LibPath'); return L ? { path: ktxt(src, L, 'Path'), v: ktxt(src, L, 'Var') } : { path: '', v: '' }; }
  function parseProject(src, info = {}) {
    const root = parse(src, 0, src.length, XT.SKIP_PRJ);
    const S = root.ch.find(n => n.t === 'Source');
    if (!S) throw new Error('Это не проект DipTrace XML (нет <Source>)');
    const type = attr(S, 'Type') || '';
    const P = { src, info, type, kind: type === 'DipTrace-Schematic' ? 'sch' : type === 'DipTrace-PCB' ? 'pcb' : '', version: attr(S, 'Version') || '', items: [], cache: null, related: null, name: info.name || '' };
    if (!P.kind) throw new Error('Неизвестный тип проекта: ' + type);
    const L = kid(S, 'Library');
    if (L) {
      // кэш библиотеки проекта читаем тем же загрузчиком, что и библиотеки
      const sub = src.slice(L.s, L.e);
      try { P.cache = DT.load(sub, { name: 'кэш проекта' }); } catch (e) { P.cacheErr = e.message; }
    }
    const compByStyle = new Map(), patByStyle = new Map();
    if (P.cache) {
      if (P.cache.kind === 'e') for (const r of P.cache.rows) { const cs = attr(r.node, 'ComponentStyle'); if (cs) compByStyle.set(cs, r); }
      for (const p of P.cache.pats) if (p.style) patByStyle.set(p.style, p);
    }
    if (P.kind === 'sch') {
      const C = kid(kid(S, 'Schematic'), 'Components');
      const seen = new Map();
      for (const n of kids(C, 'Part')) {
        const cs = attr(n, 'ComponentStyle') || '', uid = attr(n, 'UpdateId') || '';
        const cc = compByStyle.get(cs) || null;
        // секции многосекционного компонента — один элемент
        const key = uid && attr(n, 'PartNumber') ? uid : null;
        const it = { kind: 'sch', node: n, refdes: ktxt(src, n, 'RefDes'), name: ktxt(src, n, 'Name'), base: ktxt(src, n, 'BaseName'), value: ktxt(src, n, 'Value'), lp: libPathOf(src, n), style: cs, uid, sheet: attr(n, 'Sheet') || '', cc, pat: cc && cc.p ? cc.p : null };
        if (key && seen.has(key)) { seen.get(key).parts++; continue; }
        it.parts = 1; if (key) seen.set(key, it); P.items.push(it);
      }
    } else {
      const B = kid(S, 'Board'); const C = kid(B, 'Components');
      for (const n of kids(C, 'Component')) {
        const ps = attr(n, 'PatternStyle') || '', hp = kids(kid(n, 'HierarchyPath'), 'Item').map(x => txt(src, x));
        P.items.push({ kind: 'pcb', node: n, refdes: ktxt(src, n, 'RefDes'), name: ktxt(src, n, 'Name'), value: ktxt(src, n, 'Value'), lp: libPathOf(src, n), style: ps, uid: attr(n, 'UpdateId') || '', link: hp.length ? hp[hp.length - 1] : (attr(n, 'UpdateId') || ''), pat: patByStyle.get(ps) || null, cc: null });
      }
      const m = src.match(/<RelatedSchem>\s*<Path>([^<]*)<\/Path>\s*<Var>([^<]*)<\/Var>/) || src.match(/<RelatedSchem>\s*<Path>([^<]*)<\/Path>/);
      if (m) P.related = { path: XT.decode(m[1]), v: m[2] ? XT.decode(m[2]) : '' };
    }
    return P;
  }

  /* Устаревшие пути .eli/.lib в любом файле: <Path>…\x.eli</Path>, <Var>…\x.eli</Var> */
  const OLD_RE = /<(Path|Var)>([^<]*?\.(eli|lib))<\/\1>/gi;
  function oldPaths(src) {
    const m = new Map(); OLD_RE.lastIndex = 0; let x;
    while ((x = OLD_RE.exec(src))) { const v = XT.decode(x[2]); let e = m.get(v); if (!e) m.set(v, e = { old: v, ext: x[3].toLowerCase(), n: 0, tag: new Set() }); e.n++; e.tag.add(x[1]); }
    return [...m.values()];
  }
  function suggestNew(old) { return old.replace(/\.eli$/i, '.elixml').replace(/\.lib$/i, '.libxml'); }
  function fixPaths(src, map) { // map: old → new
    OLD_RE.lastIndex = 0;
    return src.replace(OLD_RE, (all, tag, val) => { const v = XT.decode(val); return map.has(v) ? `<${tag}>${XT.encT(map.get(v))}</${tag}>` : all; });
  }

  /* Сравнение 3D двух корпусов */
  function m3sig(p) {
    const d = p.d; const f = FSX.base(d.M3Var || d.M3Path).toLowerCase();
    return { type: d.M3Type || '', file: f, rot: d.M3Rot, off: d.M3Off, zoom: d.M3Zoom };
  }
  function m3diff(a, b) {
    const x = m3sig(a), y = m3sig(b), out = [];
    if (x.type !== y.type) out.push(`тип ${x.type || '—'} ≠ ${y.type || '—'}`);
    if (x.type === 'File' || y.type === 'File') {
      if (x.file !== y.file) out.push(`файл ${x.file || '—'} ≠ ${y.file || '—'}`);
      for (const k of ['rot', 'off', 'zoom']) if ((x[k] || '') !== (y[k] || '')) out.push(`${{ rot: 'поворот', off: 'смещение', zoom: 'масштаб' }[k]} ${x[k] || '—'} ≠ ${y[k] || '—'}`);
    }
    return out;
  }

  /* ---------- Кросс-проверка ----------
     libs: [{ lib, name, win }] — загруженные библиотеки; projects: [{ prj, name, win }] */
  function run(libs, projects, opt = {}) {
    const issues = [], add = (lvl, cat, where, obj, msg, fix) => issues.push({ lvl, cat, where, obj, msg, fix });
    const E = libs.filter(x => x.lib.kind === 'e'), Lp = libs.filter(x => x.lib.kind === 'l');
    const status = p => FSX.resolve(p.d.M3Path, p.d.M3Var, opt.projDir);
    // индекс корпусов .libxml по имени
    const patIdx = new Map();
    for (const L of Lp) for (const p of L.lib.pats) if (p.status !== 'del') { const k = p.d.Pattern; if (!patIdx.has(k)) patIdx.set(k, []); patIdx.get(k).push({ L, p }); }
    // индекс компонентов по библиотеке и по имени
    const libByStem = new Map(), compIdx = new Map();
    for (const L of libs) { const s = FSX.stem(L.name).toLowerCase(); if (!libByStem.has(s)) libByStem.set(s, []); libByStem.get(s).push(L); }
    for (const L of E) for (const r of L.lib.rows) if (r.status !== 'del') { const k = r.d.Name; if (!compIdx.has(k)) compIdx.set(k, []); compIdx.get(k).push({ L, r }); }
    const refModels = new Set();
    const checkModel = (where, obj, p, L, extra) => {
      const d = p.d; if (d.M3Type !== 'File') return { st: d.M3Type ? 'gen' : 'none' };
      if (!d.M3Path && !d.M3Var) { add('warn', '3D', where, obj, '3D: тип File, но путь не задан', L ? { t: 'attach', L, p } : null); return { st: 'none' }; }
      const s = status(p); if (s.st === 'ok') refModels.add(FSX.low(s.win));
      if (s.st === 'miss') {
        const alt = FSX.byName(d.M3Var || d.M3Path, /\.(step|stp)$/i);
        add('err', '3D', where, obj, `3D-модель не найдена: ${d.M3Var || d.M3Path}` + (alt.length ? ` — найдено по имени: ${alt.slice(0, 3).map(a => a.win).join('; ')}` : '') + (extra || ''), L ? (alt.length ? { t: 'relink', L, p, to: alt[0] } : { t: 'attach', L, p }) : null);
      }
      if (s.st === 'unk') add('info', '3D', where, obj, `3D: папка «${FSX.norm(s.win).split('\\').slice(0, -1).join('\\')}» не подключена — наличие файла не проверено`, null);
      if (d.M3Path && d.M3Var && !/^%projectdir%/i.test(d.M3Var)) { const w = FSX.varToWin(d.M3Var); if (w && FSX.low(w) !== FSX.low(d.M3Path)) add('info', '3D', where, obj, `3D: Path и Var указывают на разные файлы: ${d.M3Path} ≠ ${d.M3Var}`, L ? { t: 'syncpath', L, p, win: w } : null); }
      return s;
    };
    // 1. Библиотеки корпусов
    for (const L of Lp) for (const p of L.lib.pats) if (p.status !== 'del') checkModel(L.name, p.d.Pattern, p, L);
    // 2. Библиотеки компонентов
    const matrix = [];
    for (const L of E) {
      const seenPat = new Set();
      for (const r of L.lib.rows) {
        if (r.status === 'del') continue;
        const row = { comp: r.d.Name, lib: L.name, L, r, pat: r.p ? r.p.d.Pattern : '', libxml: '', m3: '', m3st: '', sch: [], pcb: [], notes: [] };
        if (r.p) {
          const p = r.p; row.m3 = p.d.M3Type === 'File' ? (p.d.M3Var || p.d.M3Path) : p.d.M3Type;
          const s = seenPat.has(p) ? (p._st || status(p)) : checkModel(L.name, `корпус ${p.d.Pattern} (компонент ${r.d.Name})`, p, L); p._st = s; seenPat.add(p);
          row.m3st = p.d.M3Type === 'File' ? s.st : p.d.M3Type ? 'gen' : 'none';
          const cand = patIdx.get(p.d.Pattern);
          if (!cand) { if (Lp.length) { row.notes.push('корпуса нет в .libxml'); if (!seenPat.has('#' + p.d.Pattern)) add('info', 'Корпус', L.name, p.d.Pattern, 'Корпус не найден ни в одной загруженной .libxml', null); } }
          else {
            const c = cand[0]; row.libxml = c.L.name + (cand.length > 1 ? ` (+${cand.length - 1})` : '');
            const df = m3diff(p, c.p);
            if (df.length && !seenPat.has('#' + p.d.Pattern)) add('warn', 'Корпус↔3D', L.name, `${p.d.Pattern}`, `3D в .elixml и в ${c.L.name} различается: ${df.join(', ')}`, { t: 'sync3d', a: { L, p }, b: c });
            if (df.length) row.notes.push('3D ≠ .libxml');
            if (p.d.PadsN !== c.p.d.PadsN && !seenPat.has('#' + p.d.Pattern)) { add('warn', 'Корпус', L.name, p.d.Pattern, `Число площадок: .elixml ${p.d.PadsN}, ${c.L.name} ${c.p.d.PadsN}`, null); row.notes.push('площадки ≠'); }
            if (cand.length > 1 && !seenPat.has('#' + p.d.Pattern)) add('info', 'Корпус', L.name, p.d.Pattern, `Корпус с этим именем есть в нескольких .libxml: ${cand.map(x => x.L.name).join(', ')}`, null);
          }
          seenPat.add('#' + p.d.Pattern);
        }
        matrix.push(row);
      }
      if (L.lib.oldPaths && L.lib.oldPaths.length) add('warn', 'Пути', L.name, '', `Устаревшие ссылки .eli/.lib: ${L.lib.oldPaths.length} шт.`, { t: 'paths', target: L, kind: 'lib' });
    }
    for (const L of Lp) if (L.lib.oldPaths && L.lib.oldPaths.length) add('warn', 'Пути', L.name, '', `Устаревшие ссылки .eli/.lib: ${L.lib.oldPaths.length} шт.`, { t: 'paths', target: L, kind: 'lib' });
    const rowIdx = new Map(matrix.map(m => [m.lib + '\u0001' + m.comp, m]));
    // 3. Проекты
    const schs = projects.filter(x => x.prj.kind === 'sch'), pcbs = projects.filter(x => x.prj.kind === 'pcb');
    for (const X of projects) {
      const P = X.prj, where = X.name; const miss = new Map();
      const op = oldPaths(P.src);
      if (op.length) add('warn', 'Пути', where, '', `Ссылки на устаревшие библиотеки .eli/.lib: ${op.length} разных путей, ${op.reduce((s, x) => s + x.n, 0)} вхождений. Предлагается заменить на .elixml/.libxml`, { t: 'paths', target: X, kind: 'prj' });
      for (const it of P.items) {
        if (P.kind === 'pcb' && !it.name && !it.pat) continue;
        const ref = it.refdes || '(без RefDes)', obj = `${ref} ${it.name}`;
        const lpFile = it.lp.v || it.lp.path;
        let found = null, libs2 = [];
        if (lpFile) {
          libs2 = (libByStem.get(FSX.stem(lpFile).toLowerCase()) || []).filter(l => l.lib.kind === (P.kind === 'sch' ? 'e' : 'e'));
          if (!libs2.length && P.kind === 'pcb') libs2 = (libByStem.get(FSX.stem(lpFile).toLowerCase()) || []);
        }
        const names = P.kind === 'sch' ? [it.base, it.name].filter(Boolean) : [it.name];
        if (P.kind === 'sch' || (P.kind === 'pcb' && libs2.some(l => l.lib.kind === 'e'))) {
          for (const L of libs2.filter(l => l.lib.kind === 'e')) { for (const nm of names) { const r = L.lib.rows.find(x => x.status !== 'del' && x.d.Name === nm); if (r) { found = { L, r }; break; } } if (found) break; }
          if (!found) for (const nm of names) { const c = compIdx.get(nm); if (c) { found = c[0]; break; } }
        }
        if (P.kind === 'pcb' && !found && it.pat) {
          // плата без связи с компонентом: ищем корпус в .libxml
          const c = patIdx.get(it.pat.d.Pattern);
          if (lpFile && /\.lib(xml)?$/i.test(lpFile) && !c) add('err', 'Проект↔корпус', where, obj, `Корпус «${it.pat.d.Pattern}» не найден в загруженных .libxml`, null);
          if (c) { const df = m3diff(it.pat, c[0].p); if (df.length) add('warn', 'Проект↔3D', where, obj, `3D корпуса ${it.pat.d.Pattern} в плате отличается от ${c[0].L.name}: ${df.join(', ')}. Обновите компонент из библиотеки в DipTrace`, null); }
        }
        if (lpFile && !libs2.length) { const k = FSX.base(lpFile).toLowerCase(); if (!miss.has(k)) miss.set(k, { f: FSX.base(lpFile), refs: [] }); miss.get(k).refs.push(ref); }
        if (!found && (P.kind === 'sch' || libs2.some(l => l.lib.kind === 'e'))) {
          if (P.kind === 'sch' && !it.cc) continue;
          if (!lpFile && P.kind === 'sch') { add('info', 'Проект↔библиотека', where, obj, 'Компонент без ссылки на библиотеку (LibPath пуст)', null); continue; }
          add('err', 'Проект↔компонент', where, obj, `Компонент «${names[0]}» не найден в загруженных .elixml`, null);
        }
        if (found) {
          const m = rowIdx.get(found.L.name + '\u0001' + found.r.d.Name); if (m) (P.kind === 'sch' ? m.sch : m.pcb).push(`${ref}@${X.name}`);
          if (found.L !== libs2[0] && libs2.length) add('info', 'Проект↔библиотека', where, obj, `Найден в другой библиотеке: ${found.L.name}`, null);
          const lp = found.r.p, pp = it.pat || (it.cc && it.cc.p);
          if (lp && pp) {
            if (lp.d.Pattern !== pp.d.Pattern) add('warn', 'Проект↔корпус', where, obj, `Корпус в проекте «${pp.d.Pattern}», в библиотеке «${lp.d.Pattern}»`, null);
            else { const df = m3diff(pp, lp); if (df.length) add('warn', 'Проект↔3D', where, obj, `3D в проекте отличается от ${found.L.name}: ${df.join(', ')}. Обновите компонент из библиотеки в DipTrace`, null); }
          } else if (lp && !pp && P.kind === 'sch' && it.cc) add('info', 'Проект↔корпус', where, obj, `В проекте корпус не привязан, в библиотеке — «${lp.d.Pattern}»`, null);
        }
      }
      for (const m of miss.values()) add('warn', 'Проект↔библиотека', where, m.refs.length + ' комп.', `Библиотека «${m.f}» не загружена (нет в папке библиотек${/\.(eli|lib)$/i.test(m.f) ? '; путь устаревший — .eli/.lib' : ''}): ${m.refs.slice(0, 30).join(', ')}${m.refs.length > 30 ? '…' : ''}`, null);
      // 3D-модели из кэша проекта
      if (P.cache) { const done = new Set(); for (const p of P.cache.pats) { if (done.has(p.d.Pattern + p.d.M3Var)) continue; done.add(p.d.Pattern + p.d.M3Var); const users = P.items.filter(i => (i.pat || (i.cc && i.cc.p)) === p); if (!users.length) continue; checkModel(where, `корпус ${p.d.Pattern} (${users.slice(0, 4).map(u => u.refdes).join(', ')}${users.length > 4 ? '…' : ''})`, p, null, ' — в проекте'); } }
    }
    // 4. Схема ↔ плата
    for (const B of pcbs) {
      const rel = B.prj.related; let pair = null;
      if (rel) pair = schs.find(s => FSX.stem(s.name).toLowerCase() === FSX.stem(rel.v || rel.path).toLowerCase());
      if (!pair && schs.length === 1) pair = schs[0];
      if (!pair) { if (schs.length) add('info', 'Схема↔плата', B.name, '', `Связанная схема «${rel ? FSX.base(rel.v || rel.path) : '?'}» не загружена — сверка по UpdateId не выполнена`, null); continue; }
      const sm = new Map(); for (const it of pair.prj.items) if (it.uid) sm.set(it.uid, it);
      const used = new Set(); let extra = 0;
      for (const it of B.prj.items) {
        const s = sm.get(it.link);
        if (!s) { if (it.uid !== '-1' && it.name) { extra++; if (extra <= 200) add('info', 'Схема↔плата', B.name, `${it.refdes} ${it.name}`, `Нет на схеме ${pair.name} (компонент только платы)`, null); } continue; }
        used.add(s);
        if (s.name !== it.name) add('warn', 'Схема↔плата', B.name, `${it.refdes}`, `Имя на плате «${it.name}», на схеме «${s.name}» (${s.refdes})`, null);
        if ((s.value || '') !== (it.value || '')) add('warn', 'Схема↔плата', B.name, `${it.refdes}`, `Value на плате «${it.value}», на схеме «${s.value}» (${s.refdes})`, null);
        const sp = s.pat; if (sp && it.pat && sp.d.Pattern !== it.pat.d.Pattern) add('warn', 'Схема↔плата', B.name, `${it.refdes}`, `Корпус на плате «${it.pat.d.Pattern}», на схеме «${sp.d.Pattern}»`, null);
        if (sp && it.pat && sp.d.Pattern === it.pat.d.Pattern) { const df = m3diff(sp, it.pat); if (df.length) add('info', 'Схема↔плата', B.name, `${it.refdes}`, `3D корпуса ${sp.d.Pattern} в схеме и плате различается: ${df.join(', ')}`, null); }
      }
      for (const s of pair.prj.items) if (!used.has(s) && s.pat) add('warn', 'Схема↔плата', pair.name, `${s.refdes} ${s.name}`, `Компонент с корпусом не найден на плате ${B.name}`, null);
    }
    // 5. Модели, на которые никто не ссылается
    const unused = FSX.list(/\.(step|stp)$/i).filter(m => !refModels.has(FSX.low(m.win)) && !/\\_backup\\/i.test(m.win));
    return { issues, matrix, unused, refModels };
  }
  return { parseProject, oldPaths, suggestNew, fixPaths, m3diff, run };
})();
if (typeof module !== 'undefined') module.exports = XR;
