/*
 * Missy's presence — "Neon Lobes" brain (v2, default).
 * A solid, glossy 3D brain built from rounded sections with dark gaps between them.
 * Each section has its own neon outline, glowing veins and a polished highlight,
 * and carries a business label like Halli's "Explore My Brain" art.
 *
 * Same contract as the classic brain:  setState, setLevel, destroy  (+ optional setLabels)
 */
(function () {
  'use strict';

  // Neon palette — front of brain → back. Edit here to restyle.
  const PALETTE = [
    [1.00, 0.78, 0.30], // gold
    [1.00, 0.60, 0.22], // amber gold
    [1.00, 0.20, 0.62], // hot pink
    [0.93, 0.25, 0.95], // magenta
    [0.66, 0.36, 1.00], // orchid violet
    [0.30, 0.55, 1.00], // electric blue
    [1.00, 0.42, 0.78], // neon rose
    [1.00, 0.86, 0.55], // champagne
  ];

  // Sections of the right hemisphere: center (x,y,z), radii (rx,ry,rz). Left is mirrored.
  const LOBES = [
    { c: [0.30, 0.02, 0.74], r: [0.25, 0.29, 0.25] }, // frontal pole
    { c: [0.30, 0.40, 0.44], r: [0.27, 0.29, 0.31] }, // frontal top
    { c: [0.30, 0.56, -0.06], r: [0.27, 0.26, 0.34] }, // parietal crown
    { c: [0.30, 0.26, -0.62], r: [0.26, 0.30, 0.27] }, // occipital
    { c: [0.40, 0.08, 0.06], r: [0.19, 0.28, 0.33] }, // center
    { c: [0.34, -0.26, -0.40], r: [0.25, 0.23, 0.29] }, // back lower
    { c: [0.36, -0.30, 0.20], r: [0.23, 0.21, 0.36] }, // temporal
    { c: [0.30, -0.12, 0.56], r: [0.21, 0.19, 0.22] }, // lower front
  ];
  const BRAIN_CENTER = [0, 0.14, 0.02];
  const GAP = 1.075; // >1 pushes sections apart → dark seams between them

  const STATE = {
    idle:       { tint: null, tintAmt: 0.0, veinRate: 0.8, rim: 1.0, sway: 1 },
    listening:  { tint: [1.00, 0.20, 0.62], tintAmt: 0.35, veinRate: 1.6, rim: 1.25, sway: 0.4 },
    processing: { tint: [1.00, 0.78, 0.30], tintAmt: 0.30, veinRate: 3.5, rim: 1.2, sway: 0.4 },
    speaking:   { tint: null, tintAmt: 0.0, veinRate: 2.2, rim: 1.15, sway: 0.6 },
    alert:      { tint: [1.00, 0.10, 0.18], tintAmt: 0.75, veinRate: 3.0, rim: 1.35, sway: 0.3 },
  };

  // ---------------------------------------------------------------- geometry
  function lobeMesh(lobe, mirror, seed) {
    const SEG_U = 56, SEG_V = 40;
    const pos = [], idx = [];
    const c = lobe.c.slice();
    // push away from the brain center to open the gaps
    for (let i = 0; i < 3; i++) c[i] = BRAIN_CENTER[i] + (c[i] - BRAIN_CENTER[i]) * GAP;
    for (let v = 0; v <= SEG_V; v++) {
      const phi = (v / SEG_V) * Math.PI;
      for (let u = 0; u <= SEG_U; u++) {
        const th = (u / SEG_U) * Math.PI * 2;
        const d = [Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)];
        // soft cloud-like puffs and folds: rounded, polished, not medical
        const n = 1
          + 0.055 * Math.sin(6.5 * d[0] + seed) * Math.sin(5.5 * d[1] + seed * 0.7) * Math.sin(6 * d[2] + 1.3)
          + 0.035 * Math.sin(11 * d[1] + 4 * Math.sin(5 * d[2] + seed))
          + 0.025 * Math.sin(13 * d[2] + 3 * d[0] + seed);
        pos.push(c[0] + d[0] * lobe.r[0] * n, c[1] + d[1] * lobe.r[1] * n, c[2] + d[2] * lobe.r[2] * n);
      }
    }
    for (let v = 0; v < SEG_V; v++) for (let u = 0; u < SEG_U; u++) {
      const a = v * (SEG_U + 1) + u, b = a + SEG_U + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    if (mirror) for (let i = 0; i < pos.length; i += 3) pos[i] = -pos[i];
    // smooth normals
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
      const [ia, ib, ic] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
      const e1 = [pos[ib] - pos[ia], pos[ib + 1] - pos[ia + 1], pos[ib + 2] - pos[ia + 2]];
      const e2 = [pos[ic] - pos[ia], pos[ic + 1] - pos[ia + 1], pos[ic + 2] - pos[ia + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const k of [ia, ib, ic]) { nrm[k] += fn[0]; nrm[k + 1] += fn[1]; nrm[k + 2] += fn[2]; }
    }
    // orient normals outward from the lobe center (mirroring flips winding)
    const cc = mirror ? [-c[0], c[1], c[2]] : c;
    for (let i = 0; i < nrm.length; i += 3) {
      let l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      let nx = nrm[i] / l, ny = nrm[i + 1] / l, nz = nrm[i + 2] / l;
      const out = (pos[i] - cc[0]) * nx + (pos[i + 1] - cc[1]) * ny + (pos[i + 2] - cc[2]) * nz;
      if (out < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nrm[i] = nx; nrm[i + 1] = ny; nrm[i + 2] = nz;
    }
    return { pos: new Float32Array(pos), nrm, idx: new Uint16Array(idx), center: cc, radius: Math.max(...lobe.r) };
  }

  // ---------------------------------------------------------------- shaders
  const VS = `
    attribute vec3 aPos; attribute vec3 aNrm;
    uniform mat4 uProj, uView; uniform float uBreath;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj;
    void main() {
      vec3 p = aPos * (1.0 + uBreath);
      vec4 vp = uView * vec4(p, 1.0);
      vN = mat3(uView) * aNrm;
      vV = -vp.xyz;
      vObj = aPos;
      gl_Position = uProj * vp;
    }`;
  const FS = `
    precision highp float;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj;
    uniform vec3 uCol; uniform float uTime, uVeinRate, uRim, uLevel, uSeed;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    void main() {
      vec3 N = normalize(vN), V = normalize(vV);
      float ndv = max(dot(N, V), 0.0);
      float fres = pow(1.0 - ndv, 2.2);
      vec3 L1 = normalize(vec3(-0.45, 0.65, 0.6));
      vec3 L2 = normalize(vec3(0.7, -0.2, 0.4));
      float diff = max(dot(N, L1), 0.0);
      // glossy, polished highlights
      float spec = pow(max(dot(N, normalize(L1 + V)), 0.0), 90.0);
      float spec2 = pow(max(dot(N, normalize(L2 + V)), 0.0), 40.0);
      // glowing vein network (noise contour lines), flowing over time
      vec3 q = vObj * 7.0 + vec3(uSeed);
      float n1 = noise(q + vec3(0.0, uTime * 0.05, 0.0)) * 0.65 + noise(q * 2.1) * 0.35;
      float vein = 1.0 - smoothstep(0.0, 0.03, abs(n1 - 0.5));
      float n2 = noise(q * 2.6 + 11.0);
      float fine = 1.0 - smoothstep(0.0, 0.022, abs(n2 - 0.5));
      float flow = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(dot(vObj, vec3(9.0, 7.0, 11.0)) - uTime * uVeinRate), 3.0);
      vec3 deep = uCol * 0.10 + vec3(0.03, 0.01, 0.05);
      vec3 col = deep + uCol * (0.30 * diff + 0.10);
      col += mix(uCol, vec3(1.0), 0.35) * (vein * 0.9 + fine * 0.35) * flow * (1.0 + uLevel);
      col += vec3(1.0, 0.92, 0.75) * (spec * 1.1 + spec2 * 0.25);
      col += uCol * fres * 2.1 * uRim * (1.0 + uLevel * 0.8);   // neon outline
      col += vec3(1.0) * pow(1.0 - ndv, 7.0) * 0.6 * uRim;      // crisp white edge
      gl_FragColor = vec4(col, 1.0);
    }`;
  const VS_GLOW = `
    attribute vec3 aPos; attribute vec3 aCol; attribute float aSize;
    uniform mat4 uProj, uView; uniform float uScale, uTime;
    varying vec3 vCol; varying float vA;
    void main() {
      vec4 vp = uView * vec4(aPos, 1.0);
      gl_Position = uProj * vp;
      vCol = aCol;
      vA = aSize < 0.0 ? (0.5 + 0.5 * sin(uTime * 2.0 + aPos.x * 40.0 + aPos.y * 23.0)) : 1.0;
      gl_PointSize = abs(aSize) * uScale / -vp.z;
    }`;
  const FS_GLOW = `
    precision mediump float; varying vec3 vCol; varying float vA; uniform float uGlow;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0;
      float a = exp(-d * 3.0) * vA * uGlow;
      gl_FragColor = vec4(vCol * a, a);
    }`;

  // See-through glass: rims, veins and light only — the dark background shows through.
  const FS_GLASS = `
    precision highp float;
    varying vec3 vN; varying vec3 vV; varying vec3 vObj;
    uniform vec3 uCol; uniform float uTime, uVeinRate, uRim, uLevel, uSeed;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    void main() {
      vec3 N = normalize(vN), V = normalize(vV);
      if (!gl_FrontFacing) N = -N;
      float ndv = abs(dot(N, V));
      float fres = pow(1.0 - ndv, 2.4);
      vec3 q = vObj * 7.0 + vec3(uSeed);
      float n1 = noise(q + vec3(0.0, uTime * 0.06, 0.0)) * 0.65 + noise(q * 2.1) * 0.35;
      float vein = 1.0 - smoothstep(0.0, 0.028, abs(n1 - 0.5));
      float fine = 1.0 - smoothstep(0.0, 0.02, abs(noise(q * 2.6 + 11.0) - 0.5));
      float flow = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(dot(vObj, vec3(9.0, 7.0, 11.0)) - uTime * uVeinRate), 3.0);
      float spec = pow(max(dot(N, normalize(normalize(vec3(-0.45, 0.65, 0.6)) + V)), 0.0), 120.0);
      float face = gl_FrontFacing ? 1.0 : 0.3;               // back walls dimmer → depth
      vec3 col = uCol * 0.025;                                  // faint tinted glass
      col += uCol * fres * 0.95 * uRim * (1.0 + uLevel * 0.8);  // neon outline
      col += vec3(1.0) * pow(1.0 - ndv, 8.0) * 0.35 * uRim;     // crisp edge
      col += mix(uCol, vec3(1.0), 0.3) * (vein * 0.42 + fine * 0.14) * flow * (1.0 + uLevel);
      col += vec3(1.0, 0.95, 0.85) * spec * 0.8;
      gl_FragColor = vec4(col * face, 1.0);
    }`;
  const VS_LINE = `
    attribute vec3 aPos; attribute vec3 aCol; uniform mat4 uProj, uView; varying vec3 vCol;
    void main() { gl_Position = uProj * uView * vec4(aPos, 1.0); vCol = aCol; }`;
  const FS_LINE = `precision mediump float; varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 1.0); }`;

  // Jagged lightning path by midpoint displacement
  function boltPath(a, b, rough, depth) {
    let pts = [a, b];
    for (let d = 0; d < depth; d++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        const m = [(p[0] + q[0]) / 2 + (Math.random() - 0.5) * len * rough, (p[1] + q[1]) / 2 + (Math.random() - 0.5) * len * rough, (p[2] + q[2]) / 2 + (Math.random() - 0.5) * len * rough];
        next.push(m, q);
      }
      pts = next;
    }
    return pts;
  }

  function compile(gl, vs, fs) {
    const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function viewMatrix(yaw, pitch, dist) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return new Float32Array([cy, sp * sy, -cp * sy, 0, 0, cp, sp, 0, sy, -sp * cy, cp * cy, 0, 0, -0.08, -dist, 1]);
  }
  function mul4v(m, v) {
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14], m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15]];
  }

  window.createNeonBrainPresence = function (canvas, opts = {}) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return { setState() {}, setLevel() {}, setLabels() {}, destroy() {} };
    const glass = opts.mode === 'glass';
    const prog = compile(gl, VS, glass ? FS_GLASS : FS), glowProg = compile(gl, VS_GLOW, FS_GLOW), lineProg = compile(gl, VS_LINE, FS_LINE);
    const ul = { uProj: gl.getUniformLocation(lineProg, 'uProj'), uView: gl.getUniformLocation(lineProg, 'uView') };
    const U = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));
    const u = U(prog, ['uProj', 'uView', 'uBreath', 'uCol', 'uTime', 'uVeinRate', 'uRim', 'uLevel', 'uSeed']);
    const ug = U(glowProg, ['uProj', 'uView', 'uScale', 'uTime', 'uGlow']);

    // build both hemispheres
    const meshes = [];
    LOBES.forEach((lobe, i) => {
      for (const mirror of [false, true]) {
        const m = lobeMesh(lobe, mirror, i * 1.7 + (mirror ? 0.9 : 0));
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
        const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, m.nrm, gl.STATIC_DRAW);
        const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
        meshes.push({ vb, nb, ib, count: m.idx.length, color: PALETTE[i % PALETTE.length], lobe: i, mirror, center: m.center, radius: m.radius, seed: i * 3.1 + (mirror ? 5 : 0) });
      }
    });

    // glow sprites: halo behind each section + gold dust
    const gPos = [], gCol = [], gSize = [];
    meshes.forEach(m => { gPos.push(...m.center); gCol.push(...m.color.map(c => c * 0.55)); gSize.push(2.6); });
    let s = 11; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2, b = rnd() * 2 - 1, r = 1.0 + rnd() * 0.35;
      gPos.push(Math.cos(a) * Math.sqrt(1 - b * b) * r * 0.9, b * r * 0.75 + 0.14, Math.sin(a) * Math.sqrt(1 - b * b) * r * 1.15);
      const gold = rnd() < 0.7; gCol.push(...(gold ? [1, 0.82, 0.45] : [1, 0.4, 0.8])); gSize.push(-(0.05 + rnd() * 0.07));
    }
    const gpb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gPos), gl.STATIC_DRAW);
    const gcb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gcb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gCol), gl.STATIC_DRAW);
    // glass mode: light points floating inside each section
    const innerStart = gPos.length / 3;
    if (glass) meshes.forEach(m => {
      const L = LOBES[m.lobe];
      for (let i = 0; i < 26; i++) {
        let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
        gPos.push(m.center[0] + x * L.r[0] * 0.75, m.center[1] + y * L.r[1] * 0.75, m.center[2] + z * L.r[2] * 0.75);
        const c = rnd() < 0.35 ? [1, 0.85, 0.5] : m.color; gCol.push(...c.map(v => Math.min(1, v * 1.1)));
        gSize.push(-(0.035 + rnd() * 0.05));
      }
    });
    const gsb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gsb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gSize), gl.STATIC_DRAW);
    const glowCount = gPos.length / 3;
    void innerStart;

    // lightning
    const bolts = [];
    const boltBuf = gl.createBuffer(), boltCol = gl.createBuffer(), sparkBuf = gl.createBuffer(), sparkCol = gl.createBuffer(), sparkSize = gl.createBuffer();
    let boltClock = 0;
    function spawnBolt(alertMode) {
      const m = meshes[Math.floor(Math.random() * meshes.length)];
      const out = [m.center[0] - BRAIN_CENTER[0], m.center[1] - BRAIN_CENTER[1], m.center[2] - BRAIN_CENTER[2]];
      const ol = Math.hypot(...out) || 1;
      let d = [out[0] / ol + (Math.random() - 0.5) * 1.2, out[1] / ol + (Math.random() - 0.5) * 1.2, out[2] / ol + (Math.random() - 0.5) * 1.2];
      const dl = Math.hypot(...d); d = d.map(v => v / dl);
      const a = [m.center[0] + d[0] * m.radius * 0.95, m.center[1] + d[1] * m.radius * 0.95, m.center[2] + d[2] * m.radius * 0.95];
      const len = 0.18 + Math.random() * 0.38;
      const b = [a[0] + d[0] * len, a[1] + d[1] * len, a[2] + d[2] * len];
      const main = boltPath(a, b, 0.55, 4);
      const BOLT = [[1, 0.85, 0.5], [1, 0.3, 0.7], [0.95, 0.4, 1], [0.8, 0.55, 1], [1, 0.95, 0.9]];
      const color = alertMode ? [1, 0.25, 0.3] : BOLT[Math.floor(Math.random() * BOLT.length)];
      const paths = [main];
      if (Math.random() < 0.6) { // a fork
        const k = 2 + Math.floor(Math.random() * (main.length - 4));
        const f0 = main[k], f1 = [f0[0] + (Math.random() - 0.5) * len * 0.8, f0[1] + (Math.random() - 0.5) * len * 0.8, f0[2] + (Math.random() - 0.5) * len * 0.8];
        paths.push(boltPath(f0, f1, 0.6, 3));
      }
      bolts.push({ paths, color, life: 0, max: 0.09 + Math.random() * 0.16 });
    }

    // labels layer
    const layer = document.createElement('div');
    layer.className = 'brain-labels';
    canvas.parentElement.appendChild(layer);
    let labelEls = [];
    let onLabel = opts.onLabel || null;
    function setLabels(items) {
      layer.innerHTML = '';
      labelEls = (items || []).slice(0, LOBES.length).map((it, i) => {
        const el = document.createElement('button');
        el.className = 'brain-label';
        el.textContent = it.name;
        const c = PALETTE[i % PALETTE.length];
        el.style.setProperty('--lc', `rgb(${c.map(v => Math.round(v * 255)).join(',')})`);
        el.addEventListener('click', () => onLabel && onLabel(it));
        layer.appendChild(el);
        return el;
      });
    }

    // interaction: drag rotates freely (full 360); otherwise she rests in profile with a gentle sway
    let yaw = 1.2, pitch = -0.1, dragging = false, lx = 0, ly = 0, lastInteract = -1e9, homeYaw = 1.2;
    const down = e => { dragging = true; lx = e.clientX; ly = e.clientY; };
    const move = e => { if (!dragging) return; yaw += (e.clientX - lx) * 0.008; pitch = Math.max(-0.9, Math.min(0.9, pitch + (e.clientY - ly) * 0.006)); lx = e.clientX; ly = e.clientY; lastInteract = performance.now(); };
    const up = () => { dragging = false; };
    canvas.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);

    let state = 'idle', level = 0, shown = 0, raf = 0;
    const t0 = performance.now(); let last = t0;
    const cur = { tint: [1, 1, 1], tintAmt: 0, veinRate: 0.8, rim: 1, sway: 1 };

    function bind(p, name, buf, size) { const loc = gl.getAttribLocation(p, name); if (loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); }
    function unbindAll() { for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i); }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);

      const tgt = STATE[state] || STATE.idle, e = 1 - Math.pow(0.03, dt);
      const tint = tgt.tint || [1, 1, 1];
      for (let i = 0; i < 3; i++) cur.tint[i] += (tint[i] - cur.tint[i]) * e;
      cur.tintAmt += (tgt.tintAmt - cur.tintAmt) * e; cur.veinRate += (tgt.veinRate - cur.veinRate) * e;
      cur.rim += (tgt.rim - cur.rim) * e; cur.sway += (tgt.sway - cur.sway) * e;
      shown += (level - shown) * (1 - Math.pow(0.002, dt));

      // return home after a drag, then sway softly (no endless spinning)
      const idle = (now - lastInteract) / 1000;
      if (!dragging && idle > 4) {
        const target = homeYaw + Math.sin(t * 0.25) * 0.35 * cur.sway;
        let d = ((target - yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        yaw += d * 0.02; pitch += (-0.1 - pitch) * 0.02;
      }

      const proj = perspective(0.62, W / H, 0.1, 20);
      const dist = 3.35 * Math.max(1, (H / W) * 1.15);
      const view = viewMatrix(yaw, pitch, dist);
      const breath = 0.006 * Math.sin(t * 1.3) + shown * 0.025;

      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 1. halos behind (additive, no depth)
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(glowProg);
      gl.uniformMatrix4fv(ug.uProj, false, proj); gl.uniformMatrix4fv(ug.uView, false, view);
      gl.uniform1f(ug.uScale, H * 0.9); gl.uniform1f(ug.uTime, t); gl.uniform1f(ug.uGlow, (glass ? 0.16 : 0.32) * cur.rim);
      bind(glowProg, 'aPos', gpb, 3); bind(glowProg, 'aCol', gcb, 3); bind(glowProg, 'aSize', gsb, 1);
      gl.drawArrays(gl.POINTS, 0, meshes.length);
      unbindAll();

      // 2. sections — solid glossy, or see-through glass (additive, all faces)
      if (glass) { gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
      else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); }
      gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uView, false, view);
      gl.uniform1f(u.uBreath, breath); gl.uniform1f(u.uTime, t); gl.uniform1f(u.uVeinRate, cur.veinRate);
      gl.uniform1f(u.uRim, cur.rim * (state === 'alert' ? 0.85 + 0.3 * Math.sin(t * 6) : 1)); gl.uniform1f(u.uLevel, shown);
      for (const m of meshes) {
        const c = m.color.map((v, i) => v * (1 - cur.tintAmt) + cur.tint[i] * cur.tintAmt);
        gl.uniform3fv(u.uCol, c); gl.uniform1f(u.uSeed, m.seed);
        bind(prog, 'aPos', m.vb, 3); bind(prog, 'aNrm', m.nb, 3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
      }
      unbindAll();

      // 3. gold dust in front (additive, depth-tested so it sits around the brain)
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
      gl.useProgram(glowProg);
      gl.uniformMatrix4fv(ug.uProj, false, proj); gl.uniformMatrix4fv(ug.uView, false, view);
      gl.uniform1f(ug.uGlow, 0.9);
      bind(glowProg, 'aPos', gpb, 3); bind(glowProg, 'aCol', gcb, 3); bind(glowProg, 'aSize', gsb, 1);
      if (glass) gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.POINTS, meshes.length, glowCount - meshes.length);
      gl.depthMask(true);
      unbindAll();

      // 4. lightning crackling off the brain — more when she's thinking or talking
      if (glass) {
        const rate = ({ idle: 1.1, listening: 3, processing: 10, speaking: 5, alert: 9 }[state] || 1) + shown * 10;
        boltClock += dt * rate;
        while (boltClock > 1) { boltClock -= 1; spawnBolt(state === 'alert'); }
        const lp = [], lc = [], sp = [], sc = [], ss = [];
        for (let i = bolts.length - 1; i >= 0; i--) {
          const b = bolts[i]; b.life += dt;
          if (b.life > b.max) { bolts.splice(i, 1); continue; }
          const k = 1 - b.life / b.max, flick = 0.6 + 0.4 * Math.random();
          b.paths.forEach((path, pi) => {
            const bright = (pi ? 0.6 : 1) * k * flick;
            for (let j = 0; j < path.length - 1; j++) {
              lp.push(...path[j], ...path[j + 1]);
              const core = [Math.min(1, b.color[0] * 0.55 + 0.45), Math.min(1, b.color[1] * 0.45 + 0.35), Math.min(1, b.color[2] * 0.55 + 0.45)].map(v => v * bright);
              lc.push(...core, ...core);
              sp.push(...path[j]); sc.push(...b.color.map(v => v * bright * 0.85)); ss.push(0.075);
              const mid = [(path[j][0] + path[j + 1][0]) / 2, (path[j][1] + path[j + 1][1]) / 2, (path[j][2] + path[j + 1][2]) / 2];
              sp.push(...mid); sc.push(...b.color.map(v => v * bright * 0.85)); ss.push(0.075);
            }
          });
        }
        if (lp.length) {
          gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(glowProg);
          gl.uniformMatrix4fv(ug.uProj, false, proj); gl.uniformMatrix4fv(ug.uView, false, view); gl.uniform1f(ug.uGlow, 1.0);
          gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sp), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, sparkCol); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sc), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, sparkSize); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ss), gl.DYNAMIC_DRAW);
          bind(glowProg, 'aPos', sparkBuf, 3); bind(glowProg, 'aCol', sparkCol, 3); bind(glowProg, 'aSize', sparkSize, 1);
          gl.drawArrays(gl.POINTS, 0, sp.length / 3);
          unbindAll();
          gl.useProgram(lineProg);
          gl.uniformMatrix4fv(ul.uProj, false, proj); gl.uniformMatrix4fv(ul.uView, false, view);
          gl.bindBuffer(gl.ARRAY_BUFFER, boltBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lp), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, boltCol); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lc), gl.DYNAMIC_DRAW);
          bind(lineProg, 'aPos', boltBuf, 3); bind(lineProg, 'aCol', boltCol, 3);
          gl.drawArrays(gl.LINES, 0, lp.length / 3);
          unbindAll();
        }
      }

      // 5. labels on the sections facing her
      if (labelEls.length) {
        const rect = canvas.getBoundingClientRect();
        labelEls.forEach((el, i) => {
          // pick whichever hemisphere's copy of this section faces the camera more
          let best = null, bestFacing = -2;
          for (const m of meshes) {
            if (m.lobe !== i) continue;
            const vc = mul4v(view, m.center);
            const dir = [m.center[0] - BRAIN_CENTER[0], m.center[1] - BRAIN_CENTER[1], m.center[2] - BRAIN_CENTER[2]];
            const len = Math.hypot(...dir) || 1;
            const vd = mul4v(view, [dir[0] / len, dir[1] / len, dir[2] / len]).map((v, k) => v - view[12 + k]);
            const facing = vd[2];
            if (facing > bestFacing) { bestFacing = facing; best = { vc, facing, m, dir: dir.map(v => v / len) }; }
          }
          const p = [best.m.center[0] + best.dir[0] * best.m.radius * 0.6, best.m.center[1] + best.dir[1] * best.m.radius * 0.6, best.m.center[2] + best.dir[2] * best.m.radius * 0.6];
          const clip = mul4v(proj, mul4v(view, p));
          const x = (clip[0] / clip[3] * 0.5 + 0.5) * rect.width + rect.left;
          const y = (-clip[1] / clip[3] * 0.5 + 0.5) * rect.height + rect.top;
          const vis = Math.max(0, Math.min(1, (best.facing - 0.05) * 3));
          el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          el.style.opacity = vis.toFixed(2);
          el.style.pointerEvents = vis > 0.4 ? 'auto' : 'none';
        });
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      setState(v) { if (STATE[v]) state = v; },
      setLevel(v) { level = Math.max(0, Math.min(1, v || 0)); },
      setLabels(items, cb) { if (cb) onLabel = cb; setLabels(items); },
      destroy() {
        cancelAnimationFrame(raf); layer.remove();
        canvas.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      },
    };
  };
  window.createGlassBrainPresence = (canvas, opts = {}) => window.createNeonBrainPresence(canvas, { ...opts, mode: 'glass' });
})();
