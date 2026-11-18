import base64, gzip, pathlib, sys
R = pathlib.Path(__file__).parent; S = R/'src'
h = (S/'app.html').read_text(encoding='utf-8')
core = '\n'.join((S/f).read_text(encoding='utf-8') for f in ['xlsx.js','xmlcore.js','libmodel.js','fsx.js','xref.js','step3d.js'])
app = '\n'.join((S/f).read_text(encoding='utf-8') for f in ['app-ed.js','app-x.js'])
oj = (R/'vendor'/'occt-import-js'/'occt-import-js.js').read_text(encoding='utf-8')
assert '</script' not in oj.lower()
wb = base64.b64encode(gzip.compress((R/'vendor'/'occt-import-js'/'occt-import-js.wasm').read_bytes(), 9)).decode()
for k, v in [('/*__CORE__*/', core), ('/*__APP__*/', app)]:
    assert '</script' not in v.lower(), k
    h = h.replace(k, v)
h = h.replace('/*__OCCTJS__*/', oj).replace('/*__OCCTWASM__*/', wb)
out = R/'dist'/'Редактор-баз-DipTrace-XML.html'; out.parent.mkdir(exist_ok=True)
out.write_text(h, encoding='utf-8'); print(out, out.stat().st_size)
