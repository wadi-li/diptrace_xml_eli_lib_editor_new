/* Простой просмотрщик STEP: разбор через OpenCascade (occt-import-js, WebAssembly) в фоновом потоке, вывод WebGL */
const S3 = (() => {
  'use strict';
  let worker = null, seq = 0; const pending = new Map();
  async function wasmBytes() {
    const el = document.getElementById('occt-wasm'); if (!el) throw new Error('В сборку не включён модуль OpenCascade');
    const b64 = el.textContent.trim(); const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip'); const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
    return buf;
  }
  async function getWorker() {
    if (worker) return worker;
    const js = document.getElementById('occt-js').textContent;
    const wasm = await wasmBytes();
    const code = js + `
;let occt = null;
onmessage = async ev => {
  const { id, buffer, wasm, params } = ev.data;
  try {
    if (wasm) { occt = await occtimportjs({ wasmBinary: wasm }); postMessage({ id, ready: true }); return; }
    const r = occt.ReadStepFile(new Uint8Array(buffer), params);
    if (!r.success) { postMessage({ id, error: 'Не удалось разобрать STEP' }); return; }
    const meshes = r.meshes.map(m => ({ name: m.name, color: m.color || null, pos: new Float32Array(m.attributes.position.array), nrm: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null, idx: new Uint32Array(m.index.array), faces: m.brep_faces || [] }));
    postMessage({ id, meshes }, meshes.flatMap(m => [m.pos.buffer, m.idx.buffer].concat(m.nrm ? [m.nrm.buffer] : [])));
  } catch (e) { postMessage({ id, error: String(e && e.message || e) }); }
};`;
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    w.onmessage = ev => { const p = pending.get(ev.data.id); if (!p) return; pending.delete(ev.data.id); ev.data.error ? p.rej(new Error(ev.data.error)) : p.res(ev.data); };
    w.onerror = e => { for (const p of pending.values()) p.rej(new Error(e.message || 'Ошибка фонового потока')); pending.clear(); };
    await call(w, { wasm }, [wasm]);
    worker = w; return w;
  }
  function call(w, msg, tr) { return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); w.postMessage({ id, ...msg }, tr || []); }); }
  const cache = new Map();
  async function load(bytes, key) {
    if (key && cache.has(key)) return cache.get(key);
    const head = new TextDecoder().decode(bytes.slice(0, 200));
    if (/^#VRML/i.test(head)) throw new Error('Формат VRML (.wrl) просмотрщиком не поддерживается — только STEP');
    if (!/ISO-10303-21/.test(head)) throw new Error('Файл не похож на STEP (нет заголовка ISO-10303-21)');
    const w = await getWorker();
    const r = await call(w, { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), params: { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.4 } });
    if (key) { cache.set(key, r.meshes); if (cache.size > 30) cache.delete(cache.keys().next().value); }
    return r.meshes;
  }

  /* ---------- математика 4×4 (столбцы) ---------- */
  const M = {
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    persp(f, asp, n, fa) { const t = 1 / Math.tan(f / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; },
    rx(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
    ry(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
    rz(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    tr(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; },
    sc(x, y, z) { return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; },
    ap(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; }
  };
  /* Преобразование модели как в DipTrace: масштаб → поворот X, Y, Z (градусы) → смещение (мм) */
  function modelMatrix(t) {
    const d = Math.PI / 180, r = t.rot || [0, 0, 0], o = t.off || [0, 0, 0], z = t.zoom || [1, 1, 1];
    let m = M.sc(z[0] || 1, z[1] || 1, z[2] || 1);
    m = M.mul(M.rx(r[0] * d), m); m = M.mul(M.ry(r[1] * d), m); m = M.mul(M.rz(r[2] * d), m);
    return M.mul(M.tr(o[0], o[1], o[2]), m);
  }

  const VS = `attribute vec3 p;attribute vec3 n;attribute vec3 c;uniform mat4 mvp;uniform mat4 mdl;uniform mat3 nm;varying vec3 vn;varying vec3 vc;varying vec3 vp;
void main(){vec4 w=mdl*vec4(p,1.);gl_Position=mvp*w;vn=normalize(nm*n);vc=c;vp=w.xyz;}`;
  const FS = `precision mediump float;varying vec3 vn;varying vec3 vc;varying vec3 vp;uniform vec3 eye;uniform float flat_;uniform float alpha;
void main(){vec3 N=normalize(vn);vec3 V=normalize(eye-vp);if(dot(N,V)<0.)N=-N;vec3 L1=normalize(vec3(.4,.3,1.)),L2=normalize(V+vec3(0.,0.,.3));
float d=.35+.45*max(dot(N,L1),0.)+.35*max(dot(N,L2),0.);float s=pow(max(dot(N,normalize(L2+V)),0.),40.)*.25;vec3 col=mix(vc*d+s,vc,flat_);gl_FragColor=vec4(col,alpha);}`;

  class Viewer {
    constructor(canvas) {
      this.cv = canvas; const gl = this.gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL недоступен в этом браузере');
      this.ext32 = gl.getExtension('OES_element_index_uint');
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = this.pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      this.loc = { p: gl.getAttribLocation(pr, 'p'), n: gl.getAttribLocation(pr, 'n'), c: gl.getAttribLocation(pr, 'c'), mvp: gl.getUniformLocation(pr, 'mvp'), mdl: gl.getUniformLocation(pr, 'mdl'), nm: gl.getUniformLocation(pr, 'nm'), eye: gl.getUniformLocation(pr, 'eye'), flat: gl.getUniformLocation(pr, 'flat_'), alpha: gl.getUniformLocation(pr, 'alpha') };
      this.model = []; this.board = []; this.xf = { rot: [0, 0, 0], off: [0, 0, 0], zoom: [1, 1, 1] };
      this.cam = { yaw: -0.6, pitch: 0.75, dist: 20, tgt: [0, 0, 0] }; this.showPads = true; this.showModel = true;
      this.bind(); this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(canvas);
    }
    buf(data, el) { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(el ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER, b); gl.bufferData(el ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
    mkMesh(pos, nrm, col, idx, opts = {}) {
      if (!nrm) nrm = computeNormals(pos, idx);
      const big = idx.length > 65535 && pos.length / 3 > 65535;
      if (big && !this.ext32) throw new Error('Модель слишком большая для WebGL без OES_element_index_uint');
      const I = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      return { p: this.buf(pos), n: this.buf(nrm), c: this.buf(col), i: this.buf(I, true), cnt: idx.length, type: I instanceof Uint32Array ? this.gl.UNSIGNED_INT : this.gl.UNSIGNED_SHORT, ...opts, pos };
    }
    clearModel() { for (const m of this.model) for (const k of ['p', 'n', 'c', 'i']) this.gl.deleteBuffer(m[k]); this.model = []; this.bbox = null; }
    setMeshes(meshes) {
      this.clearModel();
      for (const m of meshes) {
        const nv = m.pos.length / 3, col = new Float32Array(nv * 3);
        const base = m.color ? gam(m.color) : [0.62, 0.64, 0.68];
        for (let i = 0; i < nv; i++) col.set(base, i * 3);
        for (const f of m.faces || []) { if (!f.color) continue; const c = gam(f.color); for (let t = f.first; t <= f.last; t++) for (let k = 0; k < 3; k++) col.set(c, m.idx[t * 3 + k] * 3); }
        this.model.push(this.mkMesh(m.pos, m.nrm, col, m.idx));
      }
      this.draw();
    }
    setTransform(xf) { this.xf = xf; this.draw(); }
    // площадки корпуса и контур: pads [{x,y,w,h,shape,ang,th}], size {w,h}
    setBoard(pads, size) {
      for (const m of this.board) for (const k of ['p', 'n', 'c', 'i']) this.gl.deleteBuffer(m[k]); this.board = [];
      const P = [], C = [], I = [], N = [];
      const quad = (pts, z, col) => { const b = P.length / 3; for (const [x, y] of pts) { P.push(x, y, z); N.push(0, 0, 1); C.push(...col); } for (let i = 1; i + 1 < pts.length; i++) I.push(b, b + i, b + i + 1); };
      const W = Math.max(size && size.w || 0, 1), H = Math.max(size && size.h || 0, 1);
      let ext = 0; for (const p of pads) ext = Math.max(ext, Math.abs(p.x) + p.w, Math.abs(p.y) + p.h);
      const bw = Math.max(W, ext * 2) * 1.25 + 2, bh = Math.max(H, ext * 2) * 1.25 + 2;
      quad([[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]], -0.002, [0.16, 0.42, 0.24]);
      for (const p of pads) {
        const pts = [], a = p.ang || 0, ca = Math.cos(a), sa = Math.sin(a), w2 = p.w / 2, h2 = p.h / 2;
        if (/ellipse|oval|obround|round|circle/i.test(p.shape || '')) { const r = Math.min(w2, h2), lx = w2 - r, ly = h2 - r; for (let i = 0; i < 32; i++) { const t = i / 32 * 2 * Math.PI; const cx = Math.cos(t), cy = Math.sin(t); pts.push([(cx >= 0 ? lx : -lx) + r * cx, (cy >= 0 ? ly : -ly) + r * cy]); } }
        else pts.push([-w2, -h2], [w2, -h2], [w2, h2], [-w2, h2]);
        quad(pts.map(([x, y]) => [p.x + x * ca - y * sa, p.y + x * sa + y * ca]), 0.001, p.th ? [0.85, 0.7, 0.35] : [0.82, 0.72, 0.42]);
        if (p.hole) { const hp = []; for (let i = 0; i < 20; i++) { const t = i / 20 * 2 * Math.PI; hp.push([p.x + p.hole / 2 * Math.cos(t), p.y + p.hole / 2 * Math.sin(t)]); } quad(hp, 0.002, [0.08, 0.08, 0.08]); }
      }
      if (P.length) this.board.push(this.mkMesh(new Float32Array(P), new Float32Array(N), new Float32Array(C), new Uint32Array(I), { flat: 0.6 }));
      this.boardSize = [bw, bh]; this.draw();
    }
    bounds() {
      const mm = modelMatrix(this.xf); let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const m of this.model) { const p = m.pos; const step = Math.max(3, Math.floor(p.length / 3 / 4000) * 3); for (let i = 0; i < p.length; i += step) { const v = M.ap(mm, [p[i], p[i + 1], p[i + 2]]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } } }
      if (!isFinite(mn[0])) { const b = this.boardSize || [10, 10]; mn = [-b[0] / 2, -b[1] / 2, 0]; mx = [b[0] / 2, b[1] / 2, 1]; }
      return { mn, mx };
    }
    fit() { const { mn, mx } = this.bounds(); this.cam.tgt = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; const r = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 || 5; this.cam.dist = r / Math.tan(0.35) * 1.15; this.draw(); }
    view(v) { const V = { top: [-Math.PI / 2, Math.PI / 2 - 0.0001], bottom: [-Math.PI / 2, -Math.PI / 2 + 0.0001], front: [-Math.PI / 2, 0], right: [0, 0], left: [Math.PI, 0], back: [Math.PI / 2, 0], iso: [-0.6, 0.75] }[v]; if (V) { this.cam.yaw = V[0]; this.cam.pitch = V[1]; } this.fit(); }
    eye() { const c = this.cam; return [c.tgt[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), c.tgt[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.tgt[2] + c.dist * Math.sin(c.pitch)]; }
    viewMat() {
      const e = this.eye(), t = this.cam.tgt; let f = [t[0] - e[0], t[1] - e[1], t[2] - e[2]]; const fl = Math.hypot(...f); f = f.map(x => x / fl);
      const cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw), sp = Math.sin(this.cam.pitch), cp = Math.cos(this.cam.pitch);
      const up = [-cy * sp, -sy * sp, cp];
      let s = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]; const sl = Math.hypot(...s) || 1; s = s.map(x => x / sl);
      const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
      return [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]), -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]), f[0] * e[0] + f[1] * e[1] + f[2] * e[2], 1];
    }
    draw() {
      const gl = this.gl, cv = this.cv, dpr = window.devicePixelRatio || 1, w = Math.max(1, cv.clientWidth * dpr | 0), h = Math.max(1, cv.clientHeight * dpr | 0);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      const dark = document.documentElement.dataset.theme === 'dark';
      gl.clearColor(dark ? 0.12 : 0.95, dark ? 0.13 : 0.96, dark ? 0.16 : 0.97, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.useProgram(this.pr);
      const P = M.persp(0.7, w / h, this.cam.dist / 500, this.cam.dist * 50), V = this.viewMat(), PV = M.mul(P, V);
      gl.uniformMatrix4fv(this.loc.mvp, false, new Float32Array(PV)); gl.uniform3fv(this.loc.eye, new Float32Array(this.eye()));
      const drawSet = (set, mdl, flat, alpha) => {
        gl.uniformMatrix4fv(this.loc.mdl, false, new Float32Array(mdl));
        const n = [mdl[0], mdl[1], mdl[2], mdl[4], mdl[5], mdl[6], mdl[8], mdl[9], mdl[10]]; gl.uniformMatrix3fv(this.loc.nm, false, new Float32Array(inv3t(n)));
        gl.uniform1f(this.loc.alpha, alpha);
        for (const m of set) {
          gl.uniform1f(this.loc.flat, m.flat != null ? m.flat : flat);
          for (const [k, b] of [['p', m.p], ['n', m.n], ['c', m.c]]) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(this.loc[k]); gl.vertexAttribPointer(this.loc[k], 3, gl.FLOAT, false, 0, 0); }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.i); gl.drawElements(gl.TRIANGLES, m.cnt, m.type, 0);
        }
      };
      if (this.showPads) drawSet(this.board, M.id(), 0, 1);
      if (this.showModel) drawSet(this.model, modelMatrix(this.xf), 0, 1);
      if (this.onDraw) this.onDraw();
    }
    bind() {
      const cv = this.cv; let drag = null;
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', e => {
        if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (drag.b === 0 && !drag.sh) { this.cam.yaw -= dx * 0.01; this.cam.pitch = Math.max(-1.5707, Math.min(1.5707, this.cam.pitch + dy * 0.01)); }
        else { const k = this.cam.dist * 0.0016, y = this.cam.yaw, s = Math.sin(this.cam.pitch); const r = [-Math.sin(y), Math.cos(y), 0], u = [-Math.cos(y) * s, -Math.sin(y) * s, Math.cos(this.cam.pitch)]; for (let i = 0; i < 3; i++) this.cam.tgt[i] += (-dx * r[i] + dy * u[i]) * k; }
        this.draw();
      });
      cv.addEventListener('pointerup', () => drag = null);
      cv.addEventListener('wheel', e => { e.preventDefault(); this.cam.dist *= Math.exp(e.deltaY * 0.0012); this.draw(); }, { passive: false });
      cv.addEventListener('dblclick', () => this.fit());
    }
  }
  function gam(c) { return c.map(x => Math.min(1, Math.pow(Math.max(0, x), 1 / 2.2))); }
  function inv3t(m) { // обратная транспонированная 3×3 (столбцы)
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C || 1;
    const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(x => x / det);
    return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]];
  }
  function computeNormals(p, idx) {
    const n = new Float32Array(p.length);
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3; const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; } }
    return n;
  }
  /* Площадки корпуса из библиотеки (единицы библиотеки → мм) */
  function padsOf(lib, p) {
    const src = lib.src, node = p.node; const padsN = XT.kid(node, 'Pads'); if (!padsN) return [];
    const k = /inch/i.test(lib.units) ? 25.4 : /mil/i.test(lib.units) ? 0.0254 : 1;
    if (!lib._padStyles) {
      lib._padStyles = new Map(); const PS = XT.kid(lib.PL, 'PadStyles') || XT.kid(lib.PL, 'PadTypes');
      if (PS) { XT.expand(src, PS); for (const s of PS.ch) { if (s.t !== 'PadStyle' && s.t !== 'PadType') continue; const ms = XT.kid(s, 'MainStack') || s; lib._padStyles.set(XT.attr(s, 'Name') || XT.attr(s, 'Id'), { shape: XT.attr(ms, 'Shape') || '', w: +(XT.attr(ms, 'Width') || 1), h: +(XT.attr(ms, 'Height') || 1), hole: XT.attr(s, 'Type') === 'Through' ? +(XT.attr(s, 'Hole') || 0) : 0, th: XT.attr(s, 'Type') === 'Through' }); }
      }
    }
    const tmp = XT.parse(src, padsN.cs, padsN.ce, new Set(['Number', 'Name', 'Points', 'Terminals']));
    const out = [];
    for (const pd of tmp.ch) { if (pd.t !== 'Pad') continue; const s = lib._padStyles.get(XT.attr(pd, 'Style')) || { shape: 'Rectangle', w: 1, h: 1 }; out.push({ x: +(XT.attr(pd, 'X') || 0) * k, y: +(XT.attr(pd, 'Y') || 0) * k, w: s.w * k, h: s.h * k, shape: s.shape, ang: +(XT.attr(pd, 'Angle') || 0), th: s.th, hole: s.hole * k }); }
    return out;
  }
  return { load, Viewer, padsOf, modelMatrix };
})();
