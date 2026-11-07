/*
 * Missy's presence: a holographic 3D brain rendered with raw WebGL (no libraries).
 *
 * Presence contract (any future avatar implements the same three methods):
 *   const p = createBrainPresence(canvas)
 *   p.setState('idle' | 'listening' | 'processing' | 'speaking' | 'alert')
 *   p.setLevel(0..1)   // live mic / voice energy
 *   p.destroy()
 */
(function () {
  'use strict';

  const STATE_STYLE = {
    idle:       { a: [0.30, 0.85, 1.00], b: [1.00, 0.18, 0.58], speed: 0.10, pulseRate: 1.0, glow: 0.85 },
    listening:  { a: [1.00, 0.20, 0.62], b: [0.35, 0.90, 1.00], speed: 0.06, pulseRate: 1.8, glow: 1.10 },
    processing: { a: [0.95, 0.76, 0.33], b: [0.35, 0.90, 1.00], speed: 0.32, pulseRate: 3.6, glow: 1.15 },
    speaking:   { a: [0.40, 0.92, 1.00], b: [0.95, 0.76, 0.33], speed: 0.12, pulseRate: 2.4, glow: 1.05 },
    alert:      { a: [1.00, 0.16, 0.20], b: [1.00, 0.55, 0.30], speed: 0.14, pulseRate: 3.0, glow: 1.20 },
  };

  // ---------- tiny deterministic RNG so the brain looks the same every launch ----------
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // ---------- geometry ----------
  function buildBrain() {
    const R = rng(7);
    const surface = [];
    const fold = []; // 0 = deep sulcus (dim), 1 = gyrus crest (bright)
    // Folded cortex: a warped ridge field. Its value both displaces the surface and sets brightness,
    // so the gyri read as bright winding ridges with dark grooves between them.
    const ridge = (x, y, z) => {
      const wx = x + 0.18 * Math.sin(7 * z + 3 * y), wy = y + 0.15 * Math.sin(6 * x + 5 * z), wz = z + 0.15 * Math.sin(5 * y + 4 * x);
      const v = Math.sin(14 * wx + 9 * Math.sin(4 * wz)) + Math.sin(13 * wy + 8 * Math.sin(5 * wx)) + Math.sin(12 * wz + 7 * Math.sin(4 * wy));
      return Math.abs(v) / 3; // 0..1, sharp creases at zero crossings
    };
    // Cerebrum: two hemispheres with a dark longitudinal fissure between them
    for (let h = -1; h <= 1; h += 2) {
      const cx = h * 0.33, rx = 0.45, ry = 0.6, rz = 0.88;
      let made = 0;
      while (made < 2300) {
        const u = R() * 2 - 1, th = R() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
        if (dx * h < -0.3) continue; // open medial wall → visible fissure from above and front
        let x = dx * rx, y = dy * ry, z = dz * rz;
        if (y < -0.12) y = -0.12 + (y + 0.12) * 0.5;               // flatter underside
        // temporal lobe: bulge down along the lower side, toward the front
        const tl = Math.max(0, dx * h) * Math.max(0, 1 - Math.abs(z - 0.1) / 0.5) * Math.max(0, -dy);
        y -= tl * 0.22;
        if (z > 0.55) y *= 0.92;                                     // frontal pole taper
        if (z < -0.6 && y < 0) y *= 0.7;                              // occipital tuck over cerebellum
        const r = ridge(cx + x, y, z);
        const k = 1 + 0.07 * (r - 0.5);
        // lateral (Sylvian) fissure: a dark groove above the temporal lobe
        const sylvian = Math.exp(-(((y + 0.16 - 0.25 * z) / 0.045) ** 2)) * (dx * h > 0.4 ? 1 : 0) * (z > -0.35 && z < 0.55 ? 1 : 0);
        surface.push([cx + x * k, y * k + 0.1, z * k]);
        fold.push(Math.max(0.05, r * (1 - 0.85 * sylvian)));
        made++;
      }
    }
    // Cerebellum: fine horizontal folia
    for (let i = 0; i < 700; i++) {
      const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const x = s * Math.cos(th) * 0.48, y = u * 0.21, z = s * Math.sin(th) * 0.3;
      if (z > 0.1) continue;
      const f = Math.abs(Math.sin(55 * y + 2 * x));
      surface.push([x, -0.4 + y * (1 + 0.05 * f), -0.6 + z]);
      fold.push(0.25 + 0.75 * f);
    }
    // Brainstem
    for (let i = 0; i < 220; i++) {
      const t = R(), a = R() * Math.PI * 2, r = 0.12 - t * 0.035;
      surface.push([Math.cos(a) * r, -0.3 - t * 0.6, -0.2 - t * 0.14 + Math.sin(a) * r * 0.8]);
      fold.push(0.45);
    }
    // Inner "thought" particles
    const inner = [];
    for (let i = 0; i < 520; i++) {
      const h = R() < 0.5 ? -1 : 1;
      const u = R() * 2 - 1, th = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = Math.cbrt(R()) * 0.82;
      inner.push([h * 0.3 + s * Math.cos(th) * 0.4 * r, u * 0.52 * r + 0.08, s * Math.sin(th) * 0.78 * r]);
    }

    // Neural web: connect each surface point to its 2 nearest neighbours (spatial hash)
    const edges = [];
    const cell = 0.08, grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    surface.forEach((p, i) => { const k = key(...p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const seen = new Set();
    surface.forEach((p, i) => {
      if (i % 2) return; // half the points carry links: lighter, more organic
      const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell), gz = Math.floor(p[2] / cell);
      const cand = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const list = grid.get(`${gx + a},${gy + b},${gz + c}`); if (!list) continue;
        for (const j of list) if (j !== i) {
          const q = surface[j]; const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (d < cell * cell * 1.6) cand.push([d, j]);
        }
      }
      cand.sort((m, n) => m[0] - n[0]);
      for (const [, j] of cand.slice(0, 2)) {
        const k = i < j ? `${i}-${j}` : `${j}-${i}`; if (seen.has(k)) continue; seen.add(k); edges.push([i, j]);
      }
    });

    // Long pathways: curved arcs through the interior (bezier, sampled)
    const paths = [];
    for (let n = 0; n < 70; n++) {
      const a = surface[Math.floor(R() * surface.length)], b = surface[Math.floor(R() * surface.length)];
      if (!a || !b) continue;
      const mid = [(a[0] + b[0]) * 0.3, (a[1] + b[1]) * 0.3 + 0.05, (a[2] + b[2]) * 0.3];
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 1 / 24) {
        const it = 1 - t;
        pts.push([it * it * a[0] + 2 * it * t * mid[0] + t * t * b[0], it * it * a[1] + 2 * it * t * mid[1] + t * t * b[1], it * it * a[2] + 2 * it * t * mid[2] + t * t * b[2]]);
      }
      paths.push(pts);
    }
    return { surface, fold, inner, edges, paths };
  }

  // ---------- matrices ----------
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function rotation(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) * Ry(yaw), column-major, then translate z
    return new Float32Array([
      cy, sp * sy, -cp * sy, 0,
      0, cp, sp, 0,
      sy, -sp * cy, cp * cy, 0,
      0, 0, -2.85, 1,
    ]);
  }

  // ---------- shaders ----------
  const VS_POINTS = `
    attribute vec3 aPos; attribute float aSeed; attribute float aKind; attribute float aFold;
    uniform mat4 uProj, uView; uniform float uTime, uSize, uLevel, uGlow;
    uniform vec3 uColA, uColB;
    varying vec3 vCol; varying float vAlpha;
    void main() {
      vec4 p = uView * vec4(aPos * (1.0 + 0.012 * sin(uTime * 1.4 + aSeed * 6.28) + uLevel * 0.04), 1.0);
      gl_Position = uProj * p;
      float depth = clamp((p.z + 4.05) / 2.4, 0.15, 1.0);
      float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
      float spark = step(0.994, fract(aSeed * 91.7 + uTime * 0.05));
      float shade = aKind > 0.5 ? 1.0 : (0.18 + 0.82 * aFold);
      vCol = mix(uColA, uColB, smoothstep(0.86, 1.0, aSeed) * 0.9 + spark);
      vAlpha = (aKind > 0.5 ? 0.22 : 0.95) * shade * depth * (0.75 + 0.25 * twinkle) * uGlow + spark * 0.7;
      gl_PointSize = uSize * (aKind > 0.5 ? 0.6 : (0.55 + 0.6 * aFold)) * (0.6 + depth) * (1.0 + spark * 1.4);
    }`;
  const FS_POINTS = `
    precision mediump float; varying vec3 vCol; varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
      float a = exp(-d * 18.0) * vAlpha;
      gl_FragColor = vec4(vCol * a, a);
    }`;
  const VS_LINES = `
    attribute vec3 aPos; attribute float aT;
    uniform mat4 uProj, uView; uniform float uTime, uRate, uGlow, uBase;
    uniform vec3 uColA, uColB;
    varying vec3 vCol; varying float vAlpha;
    void main() {
      vec4 p = uView * vec4(aPos, 1.0);
      gl_Position = uProj * p;
      float depth = clamp((p.z + 4.2) / 2.4, 0.1, 1.0);
      float wave = pow(0.5 + 0.5 * sin(aT * 18.0 - uTime * uRate * 2.2), 14.0);
      vCol = mix(uColA, uColB, wave);
      vAlpha = (uBase + wave * 0.9) * depth * uGlow;
    }`;
  const FS_LINES = `
    precision mediump float; varying vec3 vCol; varying float vAlpha;
    void main() { gl_FragColor = vec4(vCol * vAlpha, vAlpha); }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function buffer(gl, data) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }

  window.createBrainPresence = function (canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) { canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'no-webgl', textContent: 'Missy' })); return { setState() {}, setLevel() {}, destroy() {} }; }

    const brain = buildBrain();
    const R = rng(99);

    // points
    const pts = [], seeds = [], kinds = [], folds = [];
    brain.surface.forEach((p, i) => { pts.push(...p); seeds.push(R()); kinds.push(0); folds.push(brain.fold[i]); });
    brain.inner.forEach(p => { pts.push(...p); seeds.push(R()); kinds.push(1); folds.push(0.5); });
    const pointCount = pts.length / 3;
    const pPos = buffer(gl, new Float32Array(pts)), pSeed = buffer(gl, new Float32Array(seeds)), pKind = buffer(gl, new Float32Array(kinds)), pFold = buffer(gl, new Float32Array(folds));

    // web lines
    const web = [], webT = [];
    brain.edges.forEach(([i, j]) => { const a = brain.surface[i], b = brain.surface[j]; web.push(...a, ...b); const t = R(); webT.push(t, t + 0.02); });
    const wPos = buffer(gl, new Float32Array(web)), wT = buffer(gl, new Float32Array(webT));
    const webCount = web.length / 3;

    // pathways (line segments along arcs, aT = distance along arc → pulses travel)
    const pw = [], pwT = [];
    brain.paths.forEach((arc, n) => {
      const off = R() * 3;
      for (let k = 0; k < arc.length - 1; k++) { pw.push(...arc[k], ...arc[k + 1]); pwT.push(off + k / arc.length, off + (k + 1) / arc.length); }
    });
    const aPos = buffer(gl, new Float32Array(pw)), aT = buffer(gl, new Float32Array(pwT));
    const pathCount = pw.length / 3;

    const progP = compile(gl, VS_POINTS, FS_POINTS);
    const progL = compile(gl, VS_LINES, FS_LINES);
    const U = (prog, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)]));
    const uP = U(progP, ['uProj', 'uView', 'uTime', 'uSize', 'uLevel', 'uGlow', 'uColA', 'uColB']);
    const uL = U(progL, ['uProj', 'uView', 'uTime', 'uRate', 'uGlow', 'uBase', 'uColA', 'uColB']);

    // interaction
    let yaw = 1.25, pitch = -0.12, dragging = false, lastX = 0, lastY = 0, velYaw = 0, lastInteract = 0;
    const onDown = e => { dragging = true; lastX = e.clientX; lastY = e.clientY; lastInteract = performance.now(); };
    const onMove = e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      yaw += dx * 0.008; velYaw = dx * 0.008; pitch = Math.max(-1.0, Math.min(1.0, pitch + dy * 0.006)); lastInteract = performance.now();
    };
    const onUp = () => { dragging = false; };
    canvas.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);

    let state = 'idle', level = 0, shownLevel = 0;
    const cur = { a: [...STATE_STYLE.idle.a], b: [...STATE_STYLE.idle.b], speed: 0.1, pulseRate: 1, glow: 0.85 };
    let raf = 0, t0 = performance.now(), last = t0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      gl.viewport(0, 0, canvas.width, canvas.height);
      return dpr;
    }

    function bindAttr(prog, name, buf, size) {
      const loc = gl.getAttribLocation(prog, name); if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      const dpr = resize();
      // ease toward the target state
      const target = STATE_STYLE[state] || STATE_STYLE.idle;
      const e = 1 - Math.pow(0.02, dt);
      for (let i = 0; i < 3; i++) { cur.a[i] += (target.a[i] - cur.a[i]) * e; cur.b[i] += (target.b[i] - cur.b[i]) * e; }
      cur.speed += (target.speed - cur.speed) * e; cur.pulseRate += (target.pulseRate - cur.pulseRate) * e; cur.glow += (target.glow - cur.glow) * e;
      shownLevel += (level - shownLevel) * (1 - Math.pow(0.001, dt));

      if (!dragging) {
        const idleFor = (now - lastInteract) / 1000;
        velYaw *= 0.95;
        yaw += velYaw + (idleFor > 1.5 ? cur.speed * dt : 0);
        if (idleFor > 3) pitch += (-0.12 - pitch) * 0.01;
      }

      const proj = perspective(0.75, canvas.width / canvas.height, 0.1, 20);
      const view = rotation(yaw, pitch);
      const glow = cur.glow * (1 + shownLevel * 0.6) * (state === 'alert' ? 0.85 + 0.25 * Math.sin(t * 6) : 1);

      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.DEPTH_TEST);

      gl.useProgram(progL);
      gl.uniformMatrix4fv(uL.uProj, false, proj); gl.uniformMatrix4fv(uL.uView, false, view);
      gl.uniform1f(uL.uTime, t); gl.uniform1f(uL.uRate, cur.pulseRate * (1 + shownLevel)); gl.uniform1f(uL.uGlow, glow);
      gl.uniform3fv(uL.uColA, cur.a); gl.uniform3fv(uL.uColB, cur.b);
      gl.uniform1f(uL.uBase, 0.07);
      bindAttr(progL, 'aPos', wPos, 3); bindAttr(progL, 'aT', wT, 1); gl.drawArrays(gl.LINES, 0, webCount);
      gl.uniform1f(uL.uBase, 0.03);
      gl.uniform3fv(uL.uColA, cur.b); gl.uniform3fv(uL.uColB, [1, 0.95, 0.8]);
      bindAttr(progL, 'aPos', aPos, 3); bindAttr(progL, 'aT', aT, 1); gl.drawArrays(gl.LINES, 0, pathCount);

      gl.useProgram(progP);
      gl.uniformMatrix4fv(uP.uProj, false, proj); gl.uniformMatrix4fv(uP.uView, false, view);
      gl.uniform1f(uP.uTime, t); gl.uniform1f(uP.uSize, 7.0 * dpr * Math.min(1.4, canvas.clientHeight / 800)); gl.uniform1f(uP.uLevel, shownLevel); gl.uniform1f(uP.uGlow, glow);
      gl.uniform3fv(uP.uColA, cur.a); gl.uniform3fv(uP.uColB, cur.b);
      bindAttr(progP, 'aPos', pPos, 3); bindAttr(progP, 'aSeed', pSeed, 1); bindAttr(progP, 'aKind', pKind, 1); bindAttr(progP, 'aFold', pFold, 1);
      gl.drawArrays(gl.POINTS, 0, pointCount);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      setState(s) { if (STATE_STYLE[s]) state = s; },
      setLevel(v) { level = Math.max(0, Math.min(1, v || 0)); },
      destroy() {
        cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      },
    };
  };
})();
