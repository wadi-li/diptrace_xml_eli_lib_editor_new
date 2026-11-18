/* Разбор DipTrace XML с сохранением смещений и точечная правка текста.
   Неизменённые участки файла переносятся байт в байт. */
const XT = (() => {
  'use strict';
  // Крупные поддеревья, которые для правки полей не нужны: пропускаются целиком (сохраняются диапазоны)
  const SKIP_LIB = new Set(['Pins', 'Shapes', 'Pads', 'Groups', 'InternalConnections', 'SpiceModel', 'Holes', 'Dimensions', 'PadStyles', 'PadTypes', 'Categories', 'Terminals', 'RecoveryCode']);
  const SKIP_PRJ = new Set([...SKIP_LIB, 'Nets', 'Ratlines', 'Simulator', 'ERC', 'DRC', 'LastDRC', 'NetClasses', 'ClassToClass', 'SheetSettings', 'Settings', 'BoardOutline', 'Panel', 'LayerStackItems', 'CopperLayers', 'ViaStyles', 'Buses', 'CopperPours', 'MainLengthRule', 'ConnectivityCheck', 'Markings', 'RefDesMarking', 'NameMarking', 'ValueMarking', 'PatternMarking', 'ManufacturerMarking', 'DatasheetMarking', 'Traces', 'Wires', 'Points', 'Shape', 'Group', 'HierarchySheets', 'ProjectSettings']);
  const ATTR_RE = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  function decode(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)));
  }
  // Как в файлах DipTrace: &amp; &lt; &gt; &quot; в тексте и атрибутах
  const encT = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const encA = encT;

  /* Узел: t — тег, s — начало '<', ts — конец открывающего тега, cs/ce — содержимое, e — конец элемента,
     a — [[имя, сырое значение]], sc — самозакрывающийся, ch — дети (null — поддерево пропущено) */
  function parse(src, from = 0, to = src.length, skip = SKIP_LIB) {
    const root = { t: '#root', s: from, ts: from, cs: from, ce: to, e: to, a: [], ch: [], sc: false, p: null };
    const stack = [root]; let i = from;
    for (;;) {
      const lt = src.indexOf('<', i); if (lt < 0 || lt >= to) break;
      const c = src.charCodeAt(lt + 1);
      if (c === 63) { i = src.indexOf('?>', lt) + 2; continue; }
      if (c === 33) {
        if (src.startsWith('<!--', lt)) i = src.indexOf('-->', lt) + 3;
        else if (src.startsWith('<![CDATA[', lt)) i = src.indexOf(']]>', lt) + 3;
        else i = src.indexOf('>', lt) + 1;
        if (i < 3) break; continue;
      }
      if (c === 47) { // закрывающий тег
        const gt = src.indexOf('>', lt); const top = stack.length > 1 ? stack.pop() : root;
        top.ce = lt; top.e = gt + 1; i = gt + 1; continue;
      }
      let j = lt + 1;
      while (j < to) { const ch = src.charCodeAt(j); if (ch === 62) break; if (ch === 34 || ch === 39) { const q = src.indexOf(ch === 34 ? '"' : "'", j + 1); j = q < 0 ? to : q; } j++; }
      const gt = j, sc = src.charCodeAt(gt - 1) === 47;
      let k = lt + 1; while (k < gt) { const ch = src.charCodeAt(k); if (ch === 32 || ch === 9 || ch === 13 || ch === 10 || ch === 47 || ch === 62) break; k++; }
      const tag = src.slice(lt + 1, k);
      const a = []; if (k < gt) { const as = src.slice(k, sc ? gt - 1 : gt); ATTR_RE.lastIndex = 0; let m; while ((m = ATTR_RE.exec(as))) a.push([m[1], m[2] != null ? m[2] : m[3]]); }
      const parent = stack[stack.length - 1];
      const node = { t: tag, s: lt, ts: gt + 1, cs: gt + 1, ce: gt + 1, e: gt + 1, a, ch: [], sc, p: parent };
      parent.ch.push(node);
      if (sc) { i = gt + 1; continue; }
      if (skip && skip.has(tag)) {
        const cl = src.indexOf('</' + tag + '>', gt + 1);
        if (cl < 0) throw new Error('Не найден закрывающий тег </' + tag + '>');
        node.ce = cl; node.e = cl + tag.length + 3; node.ch = null; i = node.e; continue;
      }
      stack.push(node); i = gt + 1;
    }
    return root;
  }
  // Полный разбор поддерева, ранее пропущенного
  function expand(src, node, skip = null) {
    if (node.ch) return node;
    const r = parse(src, node.cs, node.ce, skip); node.ch = r.ch; for (const c of node.ch) c.p = node; return node;
  }
  const kid = (n, t) => n && n.ch ? n.ch.find(x => x.t === t) : undefined;
  const kids = (n, t) => n && n.ch ? n.ch.filter(x => x.t === t) : [];
  const path = (n, p) => { for (const t of p.split('/')) { n = kid(n, t); if (!n) return undefined; } return n; };
  function attr(n, k) { if (!n) return undefined; const x = n.a.find(y => y[0] === k); return x ? decode(x[1]) : undefined; }
  function txt(src, n) { if (!n || n.sc) return ''; if (n.ch && n.ch.length) return ''; return decode(src.slice(n.cs, n.ce)); }
  const ktxt = (src, n, t) => txt(src, kid(n, t));
  const raw = (src, n) => src.slice(n.s, n.e);

  function startTag(src, n, m) {
    const list = n.a.map(x => [x[0], x[1]]);
    for (const [k, v] of m) { const i = list.findIndex(x => x[0] === k); if (v == null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i][1] = encA(v); else list.push([k, encA(v)]); }
    let end = '>';
    if (n.sc) end = src.charCodeAt(n.ts - 3) === 32 ? ' />' : '/>';
    if (n.sc && !list.length) end = '/>';
    return '<' + n.t + list.map(([k, v]) => ` ${k}="${v}"`).join('') + end;
  }

  /* Набор точечных правок одного файла */
  class Ed {
    constructor(src, nl) { this.src = src; this.nl = nl; this.reps = []; this.attrs = new Map(); this.seq = 0; }
    setAttr(n, k, v) { let m = this.attrs.get(n); if (!m) this.attrs.set(n, m = new Map()); m.set(k, v == null ? null : String(v)); }
    replace(n, str) { this.reps.push([n.s, n.e, str, this.seq++]); }
    replaceRange(s, e, str) { this.reps.push([s, e, str, this.seq++]); }
    remove(n) { let s = n.s, e = n.e; if (this.src.startsWith(this.nl, e)) e += this.nl.length; this.reps.push([s, e, '', this.seq++]); }
    insertAfter(n, str) { const e = n.e; if (this.src.startsWith(this.nl, e)) this.reps.push([e + this.nl.length, e + this.nl.length, str + this.nl, this.seq++]); else this.reps.push([e, e, this.nl + str, this.seq++]); }
    insertInto(n, str) { // первым ребёнком
      if (n.sc) { const m = this.attrs.get(n); const st = startTag(this.src, { ...n, sc: false }, m || new Map()); this.attrs.delete(n); this.reps.push([n.s, n.e, st + this.nl + str + this.nl + '</' + n.t + '>', this.seq++]); return; }
      let p = n.ts; if (this.src.startsWith(this.nl, p)) { p += this.nl.length; this.reps.push([p, p, str + this.nl, this.seq++]); } else this.reps.push([p, p, this.nl + str + this.nl, this.seq++]);
    }
    insertBeforeEnd(n, str) { // последним ребёнком
      if (n.sc) { this.insertInto(n, str); return; }
      const p = n.ce; const pre = this.src.slice(Math.max(0, p - this.nl.length), p) === this.nl ? '' : this.nl;
      this.reps.push([p, p, pre + str + this.nl, this.seq++]);
    }
    get empty() { return !this.reps.length && !this.attrs.size; }
    render(s = 0, e = this.src.length) {
      const reps = this.reps.filter(r => r[0] >= s && r[1] <= e);
      for (const [n, m] of this.attrs) if (n.s >= s && n.ts <= e) reps.push([n.s, n.ts, startTag(this.src, n, m), this.seq + reps.length]);
      reps.sort((a, b) => a[0] - b[0] || (a[1] - a[0]) - (b[1] - b[0]) || a[3] - b[3]);
      let out = '', pos = s;
      for (const [a, b, str] of reps) {
        if (a < pos) throw new Error('Пересекающиеся правки XML (' + a + '<' + pos + ')');
        out += this.src.slice(pos, a) + str; pos = b;
      }
      return out + this.src.slice(pos, e);
    }
  }
  // Вставка отсутствующего элемента в порядке, принятом DipTrace
  function insertOrdered(ed, parent, tag, str, order) {
    const idx = order.indexOf(tag); let anchor = null;
    if (idx > 0 && parent.ch) for (const c of parent.ch) { const j = order.indexOf(c.t); if (j >= 0 && j < idx) anchor = c; }
    if (anchor) ed.insertAfter(anchor, str);
    else if (idx === 0 || !parent.ch || !parent.ch.length) ed.insertInto(parent, str);
    else { // нет известных предшественников — перед первым известным последователем
      const next = parent.ch.find(c => order.indexOf(c.t) > idx);
      if (next) ed.replaceRange(next.s, next.s, str + ed.nl); else ed.insertBeforeEnd(parent, str);
    }
  }
  const leaf = (tag, v) => v === '' || v == null ? `<${tag}/>` : `<${tag}>${encT(v)}</${tag}>`;
  function setText(ed, parent, tag, v, order, opt = {}) {
    const n = kid(parent, tag);
    if (n) { if (v === '' && opt.removeEmpty) ed.remove(n); else ed.replace(n, leaf(tag, v)); }
    else if (v !== '' && v != null) insertOrdered(ed, parent, tag, leaf(tag, v), order);
  }
  return { parse, expand, kid, kids, path, attr, txt, ktxt, raw, decode, encT, encA, Ed, insertOrdered, setText, leaf, startTag, SKIP_LIB, SKIP_PRJ };
})();
if (typeof module !== 'undefined') module.exports = XT;
