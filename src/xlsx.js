/* ZIP / XLSX / CSV — перенесено из редактора .asc */
const XL = (() => {
  function csvEsc(s) { s = String(s == null ? '' : s); return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(rows, sep = ';') { return '\ufeff' + rows.map(r => r.map(csvEsc).join(sep)).join('\r\n') + '\r\n'; }
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const first = text.split(/\r?\n/, 1)[0];
    const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], f = '', i = 0, inq = false; const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (inq) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } inq = false; i++; continue; } f += ch; i++; continue; }
      if (ch === '"' && f === '') { inq = true; i++; continue; }
      if (ch === sep) { row.push(f); f = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; if (ch === '\r' && text[i + 1] === '\n') i++; i++; continue; }
      f += ch; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => x !== ''));
  }
  /* ---------- ZIP / XLSX ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); } catch (e) { return null; }
  }
  async function inflateRaw(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function zip(files) { // files: [{name, data: string|Uint8Array}]
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(raw); let comp = await deflateRaw(raw), method = 8;
      if (!comp || comp.length >= raw.length) { comp = raw; method = 0; }
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, raw.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + comp.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Файл не является ZIP/XLSX');
    const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {}; const dec = new TextDecoder();
    for (let k = 0; k < cnt; k++) {
      const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const lnl = dv.getUint16(lo + 26, true), lxl = dv.getUint16(lo + 28, true), ds = lo + 30 + lnl + lxl;
      const data = u8.subarray(ds, ds + csz);
      out[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; }
  function colIndex(ref) { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; }
  function sheetXml(rows, o = {}) {
    const widths = o.widths || [];
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    const fc = o.freezeCols || 0, fr = o.freezeRows || 0;
    x += '<sheetViews><sheetView workbookViewId="0"' + (o.tabSelected ? ' tabSelected="1"' : '') + '>';
    if (fr || fc) x += `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${colName(fc)}${fr + 1}" activePane="${fc && fr ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/>`;
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    const nc = Math.max(1, ...rows.map(r => r.length));
    x += '<cols>'; for (let i = 0; i < nc; i++) x += `<col min="${i + 1}" max="${i + 1}" width="${widths[i] || 14}" style="${o.textStyle ? 2 : 0}" customWidth="1"/>`; x += '</cols><sheetData>';
    rows.forEach((r, ri) => {
      x += `<row r="${ri + 1}">`;
      r.forEach((v, ci) => { if (v === '' || v == null) return; const st = ri < (o.headerRows || 0) ? 1 : (o.cellStyle ? o.cellStyle(ri, ci) : (o.textStyle ? 2 : 0)); x += `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`; });
      x += '</row>';
    });
    x += '</sheetData>';
    if (o.autoFilter && rows.length) x += `<autoFilter ref="A1:${colName(nc - 1)}${rows.length}"/>`;
    if (o.validations) { x += `<dataValidations count="${o.validations.length}">`; for (const v of o.validations) x += `<dataValidation type="list" allowBlank="1" sqref="${v.ref}"><formula1>"${xesc(v.list)}"</formula1></dataValidation>`; x += '</dataValidations>'; }
    return x + '</worksheet>';
  }
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF777777"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="49" applyNumberFormat="1"/><xf numFmtId="49" fontId="2" fillId="3" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="49" fillId="4" applyNumberFormat="1" applyFill="1"/></cellXfs></styleSheet>';
  async function writeXlsx(sheets) { // [{name, rows, opts}]
    const files = [];
    files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + sheets.map((s, i) => `<sheet name="${xesc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets><definedNames>' + sheets.map((s, i) => s.opts && s.opts.autoFilter && s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xesc(s.name)}'!$A$1:$${colName(Math.max(...s.rows.map(r => r.length)) - 1)}$${s.rows.length}</definedName>` : '').join('') + '</definedNames></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    files.push({ name: 'xl/styles.xml', data: STYLES });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.opts || {}) }));
    return zip(files);
  }
  // Минимальный XML-разбор без DOM (для Node и браузера одинаково)
  function xunesc(s) { return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1))); }
  function textOf(xml) { // конкатенация всех <t>…</t> вне <rPh>
    xml = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let s = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g; let m; while ((m = re.exec(xml))) s += m[1] ? xunesc(m[1]) : ''; return s;
  }
  function fmtNum(v) { const n = +v; if (!isFinite(n)) return v; const r = Math.round(n * 1e10) / 1e10; return String(r); }
  async function readXlsx(u8) {
    const f = await unzip(u8), dec = new TextDecoder(), S = n => f[n] ? dec.decode(f[n]) : '';
    const wb = S('xl/workbook.xml'), rels = S('xl/_rels/workbook.xml.rels');
    const relMap = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = /Id="([^"]+)"/.exec(m[0]), t = /Target="([^"]+)"/.exec(m[0]); if (id && t) relMap[id[1]] = t[1]; }
    const sst = []; const ss = S('xl/sharedStrings.xml'); for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));
    const sheets = {};
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = xunesc((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid = (/r:id="([^"]+)"/.exec(m[0]) || /\bid="([^"]+)"/.exec(m[0]) || [])[1];
      let target = relMap[rid] || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const xml = S(target); const rows = [];
      for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const rn = +((/\br="(\d+)"/.exec(rm[1]) || [])[1] || rows.length + 1); const row = []; let ci = 0;
        for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const at = cm[1], body = cm[2] || ''; const r = /\br="([A-Z]+)\d+"/.exec(at); if (r) ci = colIndex(r[1]);
          const t = (/\bt="(\w+)"/.exec(at) || [])[1]; let v = '';
          const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (t === 's') v = sst[+(vm ? vm[1] : 0)] || ''; else if (t === 'inlineStr') v = textOf(body); else if (t === 'str' || t === 'e') v = vm ? xunesc(vm[1]) : ''; else if (t === 'b') v = vm && vm[1] === '1' ? 'TRUE' : 'FALSE'; else v = vm ? fmtNum(xunesc(vm[1])) : '';
          row[ci] = v; ci++;
        }
        for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
        rows[rn - 1] = row;
      }
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets[name] = rows;
    }
    return sheets;
  }
  return { toCSV, parseCSV, writeXlsx, readXlsx, colName, unzip };
})();
if (typeof module !== 'undefined') module.exports = XL;
