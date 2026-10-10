// ─── Aerosol Background ───
// A small aerosol "instrument" rendered behind every page. Each page gets a scene
// (see SCENES) built from these layers:
//
//  Everywhere
//   • Polydisperse aerosol advected by a slow, divergence-free airflow: Brownian
//     diffusion ∝ 1/r, settling ∝ r², Stokes drag lag ∝ r², depth of field (bokeh)
//   • Coagulation: liquid droplets coalesce into spheres, soot sticks into fractal
//     chain aggregates (mobility radius ∝ N^0.46)
//   • Nucleation bursts: clouds of fresh nanoparticles that grow by condensation
//   • Hygroscopic growth: the cursor is a patch of humid air; droplets swell near it
//   • Corona: diffraction rings around the cursor sized by the local mean particle size
//   • Sky tint from Rayleigh-clean to hazy, driven by scroll and live PM2.5
//   • Vortex-pair wake behind the cursor, click puffs, depth parallax on scroll
//  Per scene
//   • Laser sheets with Mie/Rayleigh scattering lobes, diffraction rings, velocimetry
//     streaks and a multi-angle detector arc measuring the phase function (home)
//   • Gaussian plume dispersing from a source, sampled by a low-cost sensor network
//     with an interpolated concentration field (research)
//   • Concentration contour lines (research, publications, tools)
//   • Langevin (Brownian) trajectory traces (education, teaching)
//   • Fireflies: pulse-coupled oscillators that drift into sync (home)
(function () {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Scenes ──
  const page = canvas.dataset.scene || (location.pathname.split('/').pop() || 'index').replace(/\.html?$/, '');
  const SCENES = {
    index: { density: 1.0, beams: true, fireflies: true },
    research: { density: 0.7, plume: true, sensors: true, contours: 'plume' },
    publications: { density: 0.8, contours: 'field' },
    tools: { density: 0.8, contours: 'field' },
    education: { density: 0.65, traces: true },
    teaching: { density: 0.65, traces: true },
    events: { density: 1.0, burstEvery: [700, 1200] },
  };
  const scene = Object.assign({ density: 0.9, burstEvery: [1500, 2600] }, SCENES[page] || {});

  // ── Tunables ──
  const DENSITY = 1 / 7000;      // particles per px² of viewport (before scene density)
  const MIN_COUNT = 60, MAX_COUNT = 300;
  const MAX_EXTRA = { puff: 140, burst: 60, plume: 170 };
  const DRIFT_X = 0.10;          // mean breeze (px/frame)
  const D0 = 0.03;               // Brownian diffusivity scale
  const SETTLE = 0.006;          // settling velocity per r²
  const TAU0 = 6;                // drag relaxation time (frames) at r = 2
  const R_MAX = 5;               // coalescence size cap
  const FOCUS = 0.75;            // depth of the focal plane (z: 0 far … 1.2 near)
  const SOOT_FRACTION = 0.3;     // share of particles that are soot
  const AGG_FRACTION = 0.3;      // share of soot that starts as an aggregate
  const AGG_MAX = 40;            // monomers per aggregate
  const AGG_DRAW = 1.7;          // aggregates are drawn enlarged so their structure reads
  const WAKE_RADIUS = 70;        // core radius of the cursor's wake vortices
  const CURSOR_LIGHT = 190;      // radius of the cursor's light
  const HUMID_R = 150;           // radius of the cursor's humid patch
  const HUMID_TAU = 40;          // hygroscopic response time (frames)
  const GROWTH = 0.0006;         // condensational growth: d(r²)/dt
  const STREAK = 22;             // streak length (frames of travel) inside beams
  const FIREFLY_FRACTION = 0.12;
  const FLASH_WIDTH = 0.22;      // fraction of the blink cycle spent glowing
  const SYNC_RADIUS = 240;
  const SYNC_NUDGE = 0.035;
  const TRACERS = 8, TRACE_LEN = 130;   // points, sampled every 3 frames (~6.5 s)
  const CONTOUR_STEP = 20;
  const PROBE_R = 70;            // radius of the probe volume feeding the detectors
  const DETECTOR_DEG = [12, 20, 30, 45, 60, 90, 120, 150, 165];
  const MODES = [                // [weight, geometric mean r, geometric SD]
    [0.55, 0.9, 1.3],            // nucleation
    [0.35, 1.8, 1.3],            // accumulation
    [0.10, 3.2, 1.25],           // coarse
  ];
  const FLOW = [                 // stream-function modes: ψ = Σ A·sin(kx·x + ky·y + ω·t + φ)
    { kx: 0.0061, ky: 0.0089, w: 0.0021, A: 26, ph: 0.0 },
    { kx: -0.0093, ky: 0.0047, w: -0.0016, A: 22, ph: 1.7 },
    { kx: 0.0035, ky: -0.0122, w: 0.0012, A: 15, ph: 4.1 },
  ];
  const CROSS = { x: 0.9, y: 0.52 };   // where the laser sheets meet (viewport fractions)
  const BEAMS = [                // angle in radians through CROSS
    { angle: 0.30, color: [255, 92, 38], power: 1.0, sway: 0.02, period: 2600 },
    { angle: -0.42, color: [70, 190, 255], power: 0.65, sway: 0.018, period: 3400 },
  ];
  const BEAM_SIGMA = 16;
  const ENVELOPE = [[0, 0], [0.3, 0.15], [0.55, 1], [0.92, 1], [1, 0]];
  const PLUME = { x: -0.01, y: 0.84, angle: -0.16, U: 0.9, sig0: 4, a: 0.4, every: 3 };
  const AQ = { lat: 23.21, lon: 72.68, place: 'Gandhinagar', ttl: 30 * 60 * 1000 };

  const THEME = {
    dark: {
      core: [236, 232, 226], soot: [196, 192, 186], fresh: [140, 200, 255], fly: [255, 190, 100],
      coreAlpha: 1, bokeh: 0.9, glow: 0.9, halo: 0.05, beam: 1, flyGlow: 1, corona: 1,
      line: [225, 220, 210], lineAlpha: 1, field: 0.13, text: [200, 196, 190], blend: 'lighter',
      sky: { cleanTop: [22, 42, 84, 0.30], cleanBot: [8, 16, 34, 0.10], hazeTop: [58, 54, 52, 0.22], hazeBot: [128, 98, 68, 0.26] },
    },
    light: {
      core: [52, 58, 70], soot: [36, 36, 40], fresh: [30, 120, 200], fly: [255, 132, 30],
      coreAlpha: 0.85, bokeh: 0.4, glow: 0.6, halo: 0, beam: 0.75, flyGlow: 0.6, corona: 0.6,
      line: [60, 66, 80], lineAlpha: 0.85, field: 0.1, text: [70, 76, 90], blend: 'source-over',
      sky: { cleanTop: [140, 185, 240, 0.16], cleanBot: [205, 222, 245, 0.05], hazeTop: [185, 178, 168, 0.16], hazeBot: [205, 172, 128, 0.20] },
    },
  };

  let W = 0, H = 0, dpr = 1, t = 0, frame = 0;
  let particles = [];
  const extras = { puff: 0, burst: 0, plume: 0 };
  const vortices = [];
  const flashed = [];
  let pendingScroll = 0, lastScrollY = window.scrollY;
  let cursorX = null, cursorY = null, cursorLight = 0;
  let livePM = null;
  let nextBurst = 300 + Math.random() * 600;
  let coronaD = 1.6;

  // ── Helpers ──
  const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
  const isLight = () => root.classList.contains('light-mode');
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function sampleRadius() {
    let u = Math.random(), m = MODES[0];
    for (const mode of MODES) { if (u < mode[0]) { m = mode; break; } u -= mode[0]; }
    return clamp(m[1] * Math.pow(m[2], gauss()), 0.5, R_MAX);
  }

  function envelope(s) {
    if (s <= 0 || s >= 1) return 0;
    for (let i = 1; i < ENVELOPE.length; i++) {
      const [s1, v1] = ENVELOPE[i];
      if (s <= s1) { const [s0, v0] = ENVELOPE[i - 1]; return v0 + (v1 - v0) * (s - s0) / (s1 - s0); }
    }
    return 0;
  }

  function makeSprite(rgb, stops, px = 64) {
    const s = document.createElement('canvas');
    s.width = s.height = px;
    const g = s.getContext('2d');
    const h = px / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    for (const [pos, a] of stops) grad.addColorStop(pos, `rgba(${rgb.join(',')},${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    return s;
  }
  const CORE = [[0, 1], [0.35, 0.9], [1, 0]];
  const BOKEH = [[0, 0.5], [0.62, 0.55], [0.82, 0.3], [1, 0]];
  const DROPLET = [[0, 0.12], [0.6, 0.2], [0.82, 0.85], [1, 0]];
  const GLOW = [[0, 1], [0.2, 0.4], [1, 0]];
  const sprites = {};
  for (const key of ['dark', 'light']) {
    const th = THEME[key];
    sprites[key] = {
      core: makeSprite(th.core, CORE), soot: makeSprite(th.soot, CORE), bokeh: makeSprite(th.core, BOKEH),
      droplet: makeSprite(th.core, DROPLET), fresh: makeSprite(th.fresh, CORE), freshGlow: makeSprite(th.fresh, GLOW),
      flyCore: makeSprite(th.fly, CORE), flyGlow: makeSprite(th.fly, GLOW, 128),
    };
  }
  const glowSprites = BEAMS.map(b => makeSprite(b.color, GLOW));
  const cursorSprite = makeSprite([255, 196, 150], GLOW, 256);
  const aureoleSprite = makeSprite([210, 225, 255], GLOW, 256);
  const crossSprite = makeSprite([255, 236, 220], GLOW, 128);

  function drawSprite(img, x, y, size, alpha) {
    if (alpha < 0.004 || size < 0.5) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  }

  // ── Particles ──
  // Physical radius (for drag, settling, optics) including water uptake
  const physR = p => (p.mono ? p.rm : p.r) * p.gf;
  const mass = p => p.r * p.r * p.r;

  function buildAggregate(n) {
    const r0 = 1.0 + Math.random() * 0.3;
    const mono = [{ x: 0, y: 0, r: r0 }];
    for (let tries = 0; mono.length < n && tries < n * 30; tries++) {
      // Favour the newest monomers so clusters grow as open, branching chains
      const base = Math.random() < 0.6
        ? mono[mono.length - 1 - ((Math.random() * Math.min(3, mono.length)) | 0)]
        : mono[(Math.random() * mono.length) | 0];
      const r = r0 * (0.85 + Math.random() * 0.3);
      const a = Math.random() * Math.PI * 2, d = base.r + r;
      const m = { x: base.x + Math.cos(a) * d, y: base.y + Math.sin(a) * d, r };
      if (mono.every(o => o === base || (o.x - m.x) ** 2 + (o.y - m.y) ** 2 > (0.9 * (o.r + m.r)) ** 2)) mono.push(m);
    }
    return mono;
  }

  // Monomer list (positions relative to ox, oy) → aggregate centred on its mass
  function setAggregate(p, mono, ox, oy) {
    let M = 0, cx = 0, cy = 0;
    for (const o of mono) { const m = o.r ** 3; M += m; cx += o.x * m; cy += o.y * m; }
    cx /= M; cy /= M;
    let R = 0, r0 = 0;
    for (const o of mono) { o.x -= cx; o.y -= cy; R = Math.max(R, Math.hypot(o.x, o.y) + o.r); r0 += o.r; }
    p.x = ox + cx; p.y = oy + cy;
    p.mono = mono;
    p.r = Math.cbrt(M);                                   // volume-equivalent radius
    p.rm = (r0 / mono.length) * Math.pow(mono.length, 0.46); // mobility radius (Df ≈ 1.8)
    p.R = R;
  }

  function monomersWorld(p) {
    if (!p.mono) return [{ x: p.x, y: p.y, r: p.r }];
    const c = Math.cos(p.ang), s = Math.sin(p.ang);
    return p.mono.map(o => ({ x: p.x + o.x * c - o.y * s, y: p.y + o.x * s + o.y * c, r: o.r }));
  }

  function spawn(p, initial) {
    p.x = Math.random() * W;
    p.y = Math.random() * H;
    p.z = Math.random() < 0.08 ? 1 + Math.random() * 0.2 : Math.random();
    p.vx = DRIFT_X; p.vy = 0;
    p.kind = Math.random() < SOOT_FRACTION ? 'soot' : 'drop';
    p.mono = null;
    p.ang = Math.random() * Math.PI * 2; p.spin = 0;
    if (p.kind === 'soot' && Math.random() < AGG_FRACTION) {
      setAggregate(p, buildAggregate(3 + ((Math.random() ** 2) * 20 | 0)), p.x, p.y);
    } else {
      p.r = p.kind === 'soot' ? 0.9 + Math.random() * 0.5 : sampleRadius();
    }
    p.gf = 1;
    p.maxLife = 900 + Math.random() * 1600;
    p.life = initial ? Math.random() * p.maxLife * 0.8 : 0;
    p.flash = 0;
    p.extra = null;
    p.plume = null;
    p.burst = false;
    p.tracer = false;
    p.trace = null;
    p.fly = !!scene.fireflies && p.kind === 'drop' && Math.random() < FIREFLY_FRACTION;
    p.phase = Math.random();
    p.freq = 1 / (320 + Math.random() * 200);
    p.seed = Math.random() * 100;
    return p;
  }

  function makeTracer(p) {
    spawn(p, false);
    p.kind = 'drop'; p.mono = null; p.r = 0.9; p.z = FOCUS; p.fly = false;
    p.x = W * (0.08 + Math.random() * 0.84); p.y = H * (0.1 + Math.random() * 0.8);
    p.maxLife = Infinity; p.tracer = true; p.trace = []; p.ou = { x: 0, y: 0 };
    return p;
  }

  function addExtra(kind, p) {
    if (extras[kind] >= MAX_EXTRA[kind]) return false;
    p.extra = kind; p.fly = false;
    particles.push(p);
    extras[kind]++;
    return true;
  }

  function targetCount() {
    const pm = livePM === null ? 1 : 0.85 + 0.4 * clamp(livePM / 120, 0, 1);
    return Math.round(clamp(W * H * DENSITY * scene.density * pm, MIN_COUNT, MAX_COUNT));
  }

  function fillParticles() {
    const base = particles.filter(p => !p.extra && !p.tracer);
    const target = targetCount();
    while (base.length < target) base.push(spawn({}, true));
    base.length = target;
    const tracers = particles.filter(p => p.tracer);
    if (scene.traces) while (tracers.length < TRACERS) tracers.push(makeTracer({}));
    particles = base.concat(tracers, particles.filter(p => p.extra));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fillParticles();
    layoutSensors();
    contourCache = null;
    if (reducedMotion) render();
  }

  // ── Air velocity field ──
  function airVelocity(x, y, out) {
    let u = DRIFT_X, v = 0;
    for (const m of FLOW) {
      const c = Math.cos(m.kx * x + m.ky * y + m.w * t + m.ph) * m.A;
      u += m.ky * c;   //  ∂ψ/∂y
      v -= m.kx * c;   // −∂ψ/∂x
    }
    const R2 = WAKE_RADIUS * WAKE_RADIUS;
    for (const w of vortices) {
      const rx = x - w.x, ry = y - w.y, d2 = rx * rx + ry * ry;
      if (d2 > 6 * R2) continue;
      const f = w.s * Math.exp(-d2 / R2) / WAKE_RADIUS;
      u -= ry * f;
      v += rx * f;
    }
    out.u = u; out.v = v;
  }

  // ── Gaussian plume (research) ──
  // Ground-level concentration of a continuous point source in plume coordinates:
  // s downwind, n crosswind, σ(s) = σ0 + a·s^0.85, with a slow meander.
  const plume = { x: 0, y: 0, c: 1, s: 0 };
  function plumeFrame() {
    const a = PLUME.angle + 0.07 * Math.sin(t * 0.0007) + 0.03 * Math.sin(t * 0.0019 + 1);
    plume.x = PLUME.x * W; plume.y = PLUME.y * H; plume.c = Math.cos(a); plume.s = Math.sin(a);
  }
  const plumeSigma = s => PLUME.sig0 + PLUME.a * Math.pow(s, 0.85);
  const plumeMeander = s => 18 * Math.sin(s * 0.006 - t * 0.012) * Math.min(1, s / 400);
  function plumeXY(s, n) {
    const m = n + plumeMeander(s);
    return { x: plume.x + s * plume.c - m * plume.s, y: plume.y + s * plume.s + m * plume.c };
  }
  const PLUME_REF = 1 / plumeSigma(300);
  function plumeC(x, y) {
    const dx = x - plume.x, dy = y - plume.y;
    const s = dx * plume.c + dy * plume.s;
    if (s <= 1) return 0;
    const n = -dx * plume.s + dy * plume.c - plumeMeander(s);
    const sig = plumeSigma(s);
    return (1 / sig) * Math.exp(-n * n / (2 * sig * sig)) / PLUME_REF;
  }

  // ── Sensor network (research) ──
  let sensors = [];
  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = fieldCanvas.height = 0;
  function layoutSensors() {
    if (!scene.sensors) return;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const old = sensors;
    sensors = [];
    const cols = W < 700 ? 3 : 4, rows = 3;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const fx = (i + 0.5) / cols + (rnd() - 0.5) * 0.12, fy = 0.2 + j * 0.3 + (rnd() - 0.5) * 0.1;
      const prev = old[sensors.length];
      sensors.push({ x: fx * W, y: fy * H, v: prev ? prev.v : 30, target: prev ? prev.target : 30, pulse: 0, nn: [] });
    }
    for (const s of sensors) {
      s.nn = sensors.filter(o => o !== s)
        .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))
        .slice(0, 2);
    }
  }

  const AQ_STOPS = [[70, 170, 150], [230, 190, 80], [240, 110, 50], [200, 50, 60]];
  function aqColor(v) {
    const u = clamp((v - 15) / 120, 0, 1) * (AQ_STOPS.length - 1);
    const i = Math.min(AQ_STOPS.length - 2, u | 0);
    return mix(AQ_STOPS[i], AQ_STOPS[i + 1], u - i);
  }

  function sampleSensors() {
    const bg = livePM === null ? 32 : livePM;
    for (const s of sensors) {
      s.target = bg * (0.85 + 0.3 * Math.random()) + 140 * plumeC(s.x, s.y);
      s.pulse = 1;
    }
  }

  // Inverse-distance-weighted concentration map between the sensors
  function renderField(th) {
    const cell = 18;
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
    if (fieldCanvas.width !== cols || fieldCanvas.height !== rows) { fieldCanvas.width = cols; fieldCanvas.height = rows; }
    const fctx = fieldCanvas.getContext('2d');
    const img = fctx.createImageData(cols, rows), d = img.data;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      let sw = 0, sv = 0;
      for (const s of sensors) {
        const w = 1 / ((x - s.x) ** 2 + (y - s.y) ** 2 + 900);
        sw += w; sv += w * s.v;
      }
      const v = sv / sw, c = aqColor(v), k = (j * cols + i) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2];
      d[k + 3] = 255 * th.field * (0.25 + 0.75 * clamp((v - 15) / 120, 0, 1));
    }
    fctx.putImageData(img, 0, 0);
  }

  // ── Contours (marching squares) ──
  let contourCache = null;
  const MS = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 1], [3, 2]], 6: [[0, 2]], 7: [[0, 3]],
    8: [[0, 3]], 9: [[0, 2]], 10: [[0, 3], [2, 1]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
  const blobs = [];
  function fieldValue(x, y) {
    let f = 0;
    for (const b of blobs) { const d2 = (x - b.x) ** 2 + (y - b.y) ** 2; f += b.a * Math.exp(-d2 / (b.R * b.R)); }
    return f;
  }
  function computeContours() {
    const fn = scene.contours === 'plume' ? plumeC : fieldValue;
    const levels = scene.contours === 'plume' ? [0.12, 0.25, 0.5, 1.0] : [0.25, 0.45, 0.65, 0.85];
    const st = CONTOUR_STEP, cols = Math.ceil(W / st) + 1, rows = Math.ceil(H / st) + 1;
    const v = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = fn(i * st, j * st);
    contourCache = levels.map(l => {
      const segs = [];
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i], b = v[j * cols + i + 1], c = v[(j + 1) * cols + i + 1], d = v[(j + 1) * cols + i];
        const code = (a > l) << 3 | (b > l) << 2 | (c > l) << 1 | (d > l);
        if (code === 0 || code === 15) continue;
        const x = i * st, y = j * st;
        const e = [
          [x + st * (l - a) / (b - a), y],
          [x + st, y + st * (l - b) / (c - b)],
          [x + st * (l - d) / (c - d), y + st],
          [x, y + st * (l - a) / (d - a)],
        ];
        for (const [p, q] of MS[code]) segs.push(e[p][0], e[p][1], e[q][0], e[q][1]);
      }
      return segs;
    });
  }

  // ── Live PM2.5 (Open-Meteo air-quality API, no key needed) ──
  function setPM(v) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    livePM = v;
    fillParticles();
    if (reducedMotion) render();
  }
  function loadPM() {
    try {
      const cached = JSON.parse(localStorage.getItem('pm25') || 'null');
      if (cached && Date.now() - cached.at < AQ.ttl) { setPM(cached.v); return; }
    } catch (e) { /* storage unavailable */ }
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${AQ.lat}&longitude=${AQ.lon}&current=pm2_5`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) setTimeout(() => ctrl.abort(), 6000);
    fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const v = d && d.current && d.current.pm2_5;
        setPM(v);
        if (typeof v === 'number') {
          try { localStorage.setItem('pm25', JSON.stringify({ v, at: Date.now() })); } catch (e) { /* ignore */ }
        }
      })
      .catch(() => { /* offline or blocked: keep the default haze */ });
  }

  // India NAAQS-based PM2.5 categories
  function pmCategory(v) {
    if (v <= 30) return ['Good', [70, 170, 120]];
    if (v <= 60) return ['Satisfactory', [150, 190, 80]];
    if (v <= 90) return ['Moderate', [230, 190, 60]];
    if (v <= 120) return ['Poor', [240, 130, 50]];
    if (v <= 250) return ['Very poor', [220, 70, 60]];
    return ['Severe', [170, 40, 60]];
  }

  // ── Sky: Rayleigh-clean to hazy, by scroll depth and live PM2.5 ──
  const skyCanvas = document.createElement('canvas');
  let skyKey = '';
  function renderSky(th, mode, m) {
    const key = `${W}x${H}:${mode}:${Math.round(m * 50)}`;
    if (key === skyKey) return;
    skyKey = key;
    const w = Math.max(1, Math.ceil(W / 2)), h = Math.max(2, Math.ceil(H / 2));
    skyCanvas.width = w; skyCanvas.height = h;
    const sctx = skyCanvas.getContext('2d');
    const img = sctx.createImageData(w, h), d = img.data;
    const s = th.sky, top = mix(s.cleanTop, s.hazeTop, m), bot = mix(s.cleanBot, s.hazeBot, m);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1), c = mix(top, bot, v * v * (3 - 2 * v));
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, n = Math.random() - 0.5;   // dither against banding
        d[i] = c[0] + n; d[i + 1] = c[1] + n; d[i + 2] = c[2] + n; d[i + 3] = c[3] * 255 + n * 2;
      }
    }
    sctx.putImageData(img, 0, 0);
  }

  // ── Input: cursor wake/light/humidity, click puffs, scroll parallax ──
  let prevX = null, prevY = null;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { cursorX = e.clientX; cursorY = e.clientY; }
    if (prevX !== null) {
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      const sp = Math.hypot(dx, dy);
      if (sp > 2) {
        // Counter-rotating vortex pair either side of the path: a jet along the
        // motion that curls back around at the edges.
        const nx = -dy / sp, ny = dx / sp;
        const g = Math.min(sp, 24) * 0.11, off = WAKE_RADIUS * 0.5;
        vortices.push({ x: e.clientX + nx * off, y: e.clientY + ny * off, s: g });
        vortices.push({ x: e.clientX - nx * off, y: e.clientY - ny * off, s: -g });
        while (vortices.length > 24) vortices.shift();
      }
    }
    prevX = e.clientX; prevY = e.clientY;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { prevX = prevY = null; cursorX = cursorY = null; });

  window.addEventListener('pointerdown', (e) => {
    if (reducedMotion || !(e.target instanceof Element)) return;
    if (e.target.closest('a, button, input, textarea, select, label, [role="button"]')) return;
    for (let i = 0; i < 26; i++) {
      const p = spawn({}, false);
      const a = Math.random() * Math.PI * 2, d = Math.abs(gauss()) * 10;
      p.kind = 'drop'; p.mono = null;
      p.x = e.clientX + Math.cos(a) * d;
      p.y = e.clientY + Math.sin(a) * d;
      p.r = 0.6 + Math.random() * 1.1;
      p.z = 0.6 + Math.random() * 0.3;
      p.vx = Math.cos(a) * 2; p.vy = Math.sin(a) * 2;
      p.maxLife = 500 + Math.random() * 700;
      if (!addExtra('puff', p)) break;
    }
    for (const side of [-1, 1]) vortices.push({ x: e.clientX + side * 20, y: e.clientY + 8, s: side * 1.4 });
    while (vortices.length > 24) vortices.shift();
  });

  window.addEventListener('scroll', () => {
    pendingScroll += window.scrollY - lastScrollY;
    lastScrollY = window.scrollY;
  }, { passive: true });

  // ── Nucleation burst ──
  function nucleationBurst() {
    const cx = W * (0.1 + Math.random() * 0.8), cy = H * (0.15 + Math.random() * 0.7);
    for (let i = 0; i < 45; i++) {
      const p = spawn({}, false);
      p.kind = 'drop'; p.mono = null;
      p.x = cx + gauss() * 45; p.y = cy + gauss() * 35;
      p.r = 0.3 + Math.random() * 0.1;
      p.z = clamp(FOCUS + gauss() * 0.12, 0.4, 1);
      p.life = -Math.random() * 180;            // nuclei appear over ~3 s
      p.maxLife = 1800 + Math.random() * 900;
      p.burst = true;
      if (!addExtra('burst', p)) break;
    }
  }

  // ── Coagulation (spatial hash, mass-conserving) ──
  const CELL = 32;
  function touching(p, q) {
    const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
    const reach = (p.mono ? p.R : p.r) + (q.mono ? q.R : q.r);
    if (d2 > reach * reach) return false;
    if (!p.mono && !q.mono) return d2 < ((p.r + q.r) * 0.9) ** 2;
    const A = monomersWorld(p), B = monomersWorld(q);
    for (const a of A) for (const b of B) {
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < ((a.r + b.r) * 0.95) ** 2) return true;
    }
    return false;
  }

  function merge(p, q) {
    const m1 = mass(p), m2 = mass(q), M = m1 + m2;
    const vx = (p.vx * m1 + q.vx * m2) / M, vy = (p.vy * m1 + q.vy * m2) / M;
    if (p.kind === 'drop' && q.kind === 'drop' && !p.mono && !q.mono) {
      // Liquid droplets coalesce into a sphere
      const r = Math.cbrt(M);
      if (r > R_MAX) return false;
      p.x = (p.x * m1 + q.x * m2) / M;
      p.y = (p.y * m1 + q.y * m2) / M;
      p.r = r;
    } else {
      // Anything involving soot sticks where it touched: a fractal aggregate
      const all = monomersWorld(p).concat(monomersWorld(q));
      if (all.length > AGG_MAX) return false;
      const ox = p.x, oy = p.y;
      for (const o of all) { o.x -= ox; o.y -= oy; }
      setAggregate(p, all, ox, oy);
      p.ang = 0; p.kind = 'soot'; p.fly = false;
    }
    p.vx = vx; p.vy = vy;
    p.flash = 1;
    p.burst = p.burst && q.burst;
    return true;
  }

  function coagulate() {
    const grid = new Map();
    for (const p of particles) {
      if (p.life < 0 || p.tracer) continue;
      const key = ((p.x / CELL) | 0) * 100003 + ((p.y / CELL) | 0);
      let cell = grid.get(key);
      if (!cell) grid.set(key, cell = []);
      cell.push(p);
    }
    for (const cell0 of grid.values()) for (const p of cell0) {
      if (p.dead) continue;
      const cx = (p.x / CELL) | 0, cy = (p.y / CELL) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get((cx + ox) * 100003 + cy + oy);
        if (!cell) continue;
        for (const q of cell) {
          if (q === p || q.dead || p.dead || Math.abs(p.z - q.z) > 0.12) continue;
          if (touching(p, q) && merge(p, q)) q.dead = true;
        }
      }
    }
    for (const p of particles) {
      if (!p.dead) continue;
      p.dead = false;
      if (p.extra) p.remove = true; else spawn(p, false);
    }
  }

  // ── Step ──
  const air = { u: 0, v: 0 };
  function wrap(o, m) {
    let w = false;
    if (o.x < -m) { o.x += W + 2 * m; w = true; } else if (o.x > W + m) { o.x -= W + 2 * m; w = true; }
    if (o.y < -m) { o.y += H + 2 * m; w = true; } else if (o.y > H + m) { o.y -= H + 2 * m; w = true; }
    return w;
  }

  function step(dt) {
    t += dt;
    const scroll = pendingScroll; pendingScroll = 0;
    cursorLight += ((cursorX !== null ? 1 : 0) - cursorLight) * Math.min(1, 0.06 * dt);

    for (let i = vortices.length - 1; i >= 0; i--) {
      vortices[i].s *= Math.pow(0.955, dt);
      if (Math.abs(vortices[i].s) < 0.02) vortices.splice(i, 1);
    }

    if (t > nextBurst) {
      nucleationBurst();
      const [a, b] = scene.burstEvery;
      nextBurst = t + a + Math.random() * (b - a);
    }

    if (scene.plume) {
      plumeFrame();
      if (frame % PLUME.every === 0) {
        const p = spawn({}, false);
        p.mono = null;
        p.kind = Math.random() < 0.5 ? 'soot' : 'drop';
        p.r = 0.7 + Math.random() * 0.5;
        p.z = clamp(FOCUS + gauss() * 0.15, 0.3, 1);
        p.plume = { s: 2, xi: gauss() };
        p.maxLife = Infinity;
        const pos = plumeXY(2, 0);
        p.x = pos.x; p.y = pos.y;
        addExtra('plume', p);
      }
      if (frame % 45 === 0) sampleSensors();
      for (const s of sensors) {
        s.v += (s.target - s.v) * Math.min(1, 0.04 * dt);
        s.pulse *= Math.pow(0.95, dt);
      }
    }

    if (scene.contours === 'field') {
      if (!blobs.length) for (let i = 0; i < 6; i++) {
        blobs.push({ x: Math.random() * W, y: Math.random() * H, R: 180 + Math.random() * 200, a: 0.6 + Math.random() * 0.4 });
      }
      for (const b of blobs) {
        airVelocity(b.x, b.y, air);
        b.x += air.u * 0.8 * dt; b.y += air.v * 0.8 * dt - scroll * 0.05;
        wrap(b, b.R);
      }
    }

    for (const p of particles) {
      if (p.life < 0) { p.life += dt; continue; }
      p.life += dt;
      if (p.life > p.maxLife) {
        if (p.extra) { p.remove = true; continue; }
        spawn(p, false);
      }

      // Hygroscopic growth toward the humid patch around the cursor
      let hum = 0;
      if (cursorX !== null) {
        const dx = p.x - cursorX, dy = p.y - cursorY;
        hum = Math.exp(-(dx * dx + dy * dy) / (HUMID_R * HUMID_R)) * cursorLight;
      }
      p.gf += (1 + (p.kind === 'soot' ? 0.12 : 0.9) * hum - p.gf) * Math.min(1, dt / HUMID_TAU);
      const rp = physR(p);

      if (p.plume) {
        // Kinematic plume: each particle keeps its crosswind quantile ξ, so the
        // ensemble spreads exactly as σ(s)
        const pl = p.plume;
        pl.s += PLUME.U * dt;
        pl.xi += gauss() * 0.02 * Math.sqrt(dt);
        const pos = plumeXY(pl.s, pl.xi * plumeSigma(pl.s));
        p.vx = (pos.x - p.x) / dt; p.vy = (pos.y - p.y) / dt;
        p.x = pos.x; p.y = pos.y;
        if (p.x > W + 40 || p.y < -40 || p.y > H + 40) p.remove = true;
      } else {
        airVelocity(p.x, p.y, air);
        const tau = TAU0 * (rp / 2) * (rp / 2);
        const k = Math.min(1, dt / tau);
        p.vx += (air.u - p.vx) * k;
        p.vy += (air.v - p.vy) * k;
        let jx, jy;
        if (p.tracer) {
          // Langevin velocity (Ornstein–Uhlenbeck) gives smooth Brownian paths
          p.ou.x += -p.ou.x * 0.02 * dt + gauss() * 0.07 * Math.sqrt(dt);
          p.ou.y += -p.ou.y * 0.02 * dt + gauss() * 0.07 * Math.sqrt(dt);
          jx = p.ou.x * dt; jy = p.ou.y * dt;
        } else {
          const sd = Math.sqrt((D0 / rp) * dt);
          jx = gauss() * sd; jy = gauss() * sd;
        }
        p.x += p.vx * dt + jx;
        p.y += p.vy * dt + jy - scroll * 0.12 * p.z + (p.fly ? 0 : SETTLE * rp * rp * dt);
        if (p.fly) {
          p.x += Math.sin(t * 0.011 + p.seed) * 0.16 * dt;
          p.y += Math.cos(t * 0.014 + p.seed * 1.3) * 0.12 * dt;
        }
        if (wrap(p, 30) && p.trace) p.trace.length = 0;
      }

      if (p.mono) {
        p.spin = (p.spin + gauss() * 0.0006 * Math.sqrt(dt)) * 0.98;
        p.ang += p.spin * dt;
      }
      if (p.burst && p.r < 1.6) p.r = Math.sqrt(p.r * p.r + 2 * GROWTH * dt);
      if (p.flash > 0) p.flash *= Math.pow(0.93, dt);
      if (p.fly) {
        p.phase += p.freq * dt;
        if (p.phase >= 1) { p.phase -= 1; flashed.push(p); }
      }
      if (p.trace && frame % 3 === 0) {
        p.trace.push(p.x, p.y);
        if (p.trace.length > TRACE_LEN * 2) p.trace.splice(0, 2);
      }
    }

    // Pulse coupling: each flash pulls nearby fireflies' clocks forward a little
    for (const f of flashed) {
      for (const q of particles) {
        if (!q.fly || q === f || q.phase < 0.5) continue;
        const dx = q.x - f.x, dy = q.y - f.y, d2 = dx * dx + dy * dy;
        if (d2 > SYNC_RADIUS * SYNC_RADIUS) continue;
        q.phase = Math.min(0.999, q.phase + SYNC_NUDGE * (1 - Math.sqrt(d2) / SYNC_RADIUS));
      }
    }
    flashed.length = 0;

    if (particles.some(p => p.remove)) {
      particles = particles.filter(p => {
        if (!p.remove) return true;
        if (p.extra) extras[p.extra]--;
        return false;
      });
    }

    if (scene.contours && frame % 4 === 0) computeContours();
  }

  // ── Optics ──
  function beamGeometry(b) {
    const a = b.angle + Math.sin((t / b.period) * Math.PI * 2) * b.sway;
    const ux = Math.cos(a), uy = Math.sin(a);
    const cx = crossX(), cy = CROSS.y * H;
    const t0 = (-40 - cx) / ux, t1 = (W + 40 - cx) / ux;
    const x0 = cx + ux * t0, y0 = cy + uy * t0, x1 = cx + ux * t1, y1 = cy + uy * t1;
    return { x0, y0, x1, y1, len: t1 - t0, ux, uy, angle: a };
  }

  function beamExposure(g, x, y, sigma) {
    const d = (x - g.x0) * g.uy - (y - g.y0) * g.ux;
    const d2 = d * d, s2 = 2 * sigma * sigma;
    if (d2 > 9 * s2) return 0;
    const env = envelope(((x - g.x0) * g.ux + (y - g.y0) * g.uy) / g.len);
    return env && env * Math.exp(-d2 / s2);
  }

  // Scattering phase function: Rayleigh (1 + cos²θ) for small particles blending
  // into a forward-peaked Henyey–Greenstein lobe with Mie ripples for large ones
  function phaseFn(theta, rw) {
    const g = 0.85 * (1 - Math.exp(-((rw / 1.8) ** 2))), w = g / 0.85, c = Math.cos(theta);
    const ray = 0.75 * (1 + c * c);
    const hg = (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);
    const ripple = 1 + 0.3 * w * Math.cos(theta * (4 + 3 * rw)) * clamp(rw - 1.5, 0, 1);
    return ((1 - w) * ray + w * hg) * ripple;
  }

  function drawLobe(x, y, beamAngle, rw, size, color, alpha) {
    const N = 48, pmax = Math.max(phaseFn(0, rw), phaseFn(Math.PI, rw), 1.5);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const rho = size * Math.pow(Math.max(0, phaseFn(th, rw)) / pmax, 0.6);
      const a = beamAngle + th;
      if (i === 0) ctx.moveTo(x + rho * Math.cos(a), y + rho * Math.sin(a));
      else ctx.lineTo(x + rho * Math.cos(a), y + rho * Math.sin(a));
    }
    ctx.fillStyle = rgba(color, 1);
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = alpha * 0.25; ctx.fill();
    ctx.globalAlpha = alpha; ctx.stroke();
  }

  function drawBeam(b, g, th) {
    const grad = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    for (const [s, v] of ENVELOPE) grad.addColorStop(s, `rgba(${b.color.join(',')},${v})`);
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    const base = b.power * th.beam;
    for (const [w, a] of [[90, 0.012], [30, 0.022], [9, 0.04], [1.2, 0.14]]) {
      ctx.globalAlpha = a * base;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(g.x0, g.y0);
      ctx.lineTo(g.x1, g.y1);
      ctx.stroke();
    }
  }

  const detSignal = DETECTOR_DEG.map(() => 0), detSmooth = DETECTOR_DEG.map(() => 0);
  let detMax = 1e-3;
  const detRadius = () => clamp(W * 0.07, 70, 115);
  const crossX = () => Math.min(CROSS.x * W, W - detRadius() - 40);
  function drawDetectors(g, th) {
    const cx = crossX(), cy = CROSS.y * H, R = detRadius();
    const color = BEAMS[0].color;
    for (let k = 0; k < detSignal.length; k++) {
      detSmooth[k] += (detSignal[k] - detSmooth[k]) * 0.08;
      detSignal[k] = 0;
    }
    detMax = Math.max(detMax * 0.995, ...detSmooth, 1e-3);
    const ang = d => g.angle - d * Math.PI / 180;   // detectors sit on the upper side
    ctx.globalCompositeOperation = 'source-over';

    // Arc and the measured phase function
    ctx.strokeStyle = rgba(th.line, 1);
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.10 * th.lineAlpha;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, ang(DETECTOR_DEG[DETECTOR_DEG.length - 1] + 6), ang(DETECTOR_DEG[0] - 6));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    DETECTOR_DEG.forEach((d, k) => {
      const rho = R * (0.2 + 0.65 * detSmooth[k] / detMax), a = ang(d);
      if (k === 0) ctx.moveTo(cx + rho * Math.cos(a), cy + rho * Math.sin(a));
      else ctx.lineTo(cx + rho * Math.cos(a), cy + rho * Math.sin(a));
    });
    ctx.strokeStyle = rgba(color, 1);
    ctx.globalAlpha = 0.35 * th.glow;
    ctx.stroke();

    // Detector heads
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    DETECTOR_DEG.forEach((d, k) => {
      const a = ang(d), c = Math.cos(a), s = Math.sin(a), lvl = detSmooth[k] / detMax;
      ctx.globalAlpha = (0.15 + 0.6 * lvl) * th.glow;
      ctx.beginPath();
      ctx.moveTo(cx + c * (R + 2), cy + s * (R + 2));
      ctx.lineTo(cx + c * (R + 9), cy + s * (R + 9));
      ctx.stroke();
    });
    ctx.font = '500 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(th.text, 1);
    ctx.globalAlpha = 0.35 * th.lineAlpha;
    for (const d of [30, 90, 150]) {
      const a = ang(d);
      ctx.fillText(`${d}°`, cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
    }
  }

  function accumulateDetectors(p, s, rw) {
    const cx = crossX(), cy = CROSS.y * H;
    if ((p.x - cx) ** 2 + (p.y - cy) ** 2 > PROBE_R * PROBE_R) return;
    for (let k = 0; k < DETECTOR_DEG.length; k++) detSignal[k] += s * phaseFn(DETECTOR_DEG[k] * Math.PI / 180, rw);
  }

  // Corona: ring radius ∝ (k + 0.22)·λ/d, red outermost
  function drawCorona(th) {
    if (cursorX === null || cursorLight < 0.02) return;
    const base = 86 / coronaD;
    ctx.globalCompositeOperation = th.blend;
    drawSprite(aureoleSprite, cursorX, cursorY, clamp(base * 1.6, 60, 260), 0.05 * th.corona * cursorLight);
    for (const [lam, col] of [[0.7, [90, 140, 255]], [0.85, [120, 255, 150]], [1.0, [255, 90, 60]]]) {
      for (const k of [1, 2]) {
        const rho = clamp(base * (k + 0.22) * lam, 24, 320);
        ctx.strokeStyle = rgba(col, 1);
        for (const [lw, a] of [[10, 0.022], [3, 0.04]]) {
          ctx.globalAlpha = a * th.corona * cursorLight / (k * k);
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(cursorX, cursorY, rho, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  // ── Render ──
  function drawTraces(th) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(th.core, 1);
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    for (const p of particles) {
      const tr = p.trace;
      if (!tr || tr.length < 8) continue;
      const n = tr.length / 2, chunks = 8, per = Math.ceil(n / chunks);
      for (let c = 0; c < chunks; c++) {
        const a = c * per, b = Math.min(n - 1, (c + 1) * per);
        if (b <= a) continue;
        ctx.globalAlpha = 0.32 * th.lineAlpha * ((c + 1) / chunks) ** 2;
        // Quadratic curves through segment midpoints keep the path smooth
        ctx.beginPath();
        ctx.moveTo(tr[a * 2], tr[a * 2 + 1]);
        for (let i = a + 1; i < b; i++) {
          ctx.quadraticCurveTo(tr[i * 2], tr[i * 2 + 1], (tr[i * 2] + tr[i * 2 + 2]) / 2, (tr[i * 2 + 1] + tr[i * 2 + 3]) / 2);
        }
        ctx.lineTo(tr[b * 2], tr[b * 2 + 1]);
        ctx.stroke();
      }
    }
  }

  function drawContours(th) {
    if (!contourCache) computeContours();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 0.9;
    const alphas = [0.07, 0.10, 0.13, 0.20];
    contourCache.forEach((segs, li) => {
      const top = li === contourCache.length - 1;
      ctx.strokeStyle = rgba(top ? BEAMS[0].color : th.line, 1);
      ctx.globalAlpha = alphas[li] * th.lineAlpha;
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i], segs[i + 1]); ctx.lineTo(segs[i + 2], segs[i + 3]); }
      ctx.stroke();
    });
  }

  function drawSensors(th) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(th.line, 1);
    ctx.lineWidth = 0.7;
    ctx.globalAlpha = 0.08 * th.lineAlpha;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    for (const s of sensors) for (const o of s.nn) { ctx.moveTo(s.x, s.y); ctx.lineTo(o.x, o.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const s of sensors) {
      const c = aqColor(s.v);
      ctx.strokeStyle = rgba(c, 1);
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(c, 1);
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2); ctx.fill();
      if (s.pulse > 0.02) {
        ctx.globalAlpha = s.pulse * 0.3;
        ctx.beginPath(); ctx.arc(s.x, s.y, 5 + (1 - s.pulse) * 16, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 0.5 * th.lineAlpha;
      ctx.fillStyle = rgba(th.text, 1);
      ctx.fillText(`${Math.round(s.v)}`, s.x + 9, s.y - 7);
    }
  }

  function drawPlumeSource(th) {
    const x = clamp(plume.x, 6, W), y = plume.y;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(th.line, 1);
    ctx.globalAlpha = 0.25 * th.lineAlpha;
    ctx.fillRect(x - 3, y, 6, 22);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = rgba(BEAMS[0].color, 1);
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawReadout(th) {
    if (livePM === null) return;
    const [label, col] = pmCategory(livePM);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const y = H - 16;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath(); ctx.arc(20, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.45 * th.lineAlpha;
    ctx.fillStyle = rgba(th.text, 1);
    ctx.fillText(`PM2.5 · ${AQ.place} · ${Math.round(livePM)} µg/m³ · ${label}`, 30, y);
  }

  function render() {
    const mode = isLight() ? 'light' : 'dark';
    const th = THEME[mode], sp = sprites[mode];
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // Sky
    const docH = Math.max(1, document.documentElement.scrollHeight - H);
    const pmK = livePM === null ? 0.35 : clamp(livePM / 120, 0, 1);
    renderSky(th, mode, clamp(0.15 + 0.55 * pmK + 0.35 * clamp(window.scrollY / docH, 0, 1), 0, 1));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(skyCanvas, 0, 0, W, H);

    // Scene fields
    if (scene.sensors && sensors.length) {
      if (frame % 30 === 0 || !fieldCanvas.width) renderField(th);
      ctx.globalAlpha = 1;
      ctx.drawImage(fieldCanvas, 0, 0, W, H);
    }
    if (scene.contours) drawContours(th);
    if (scene.traces) drawTraces(th);

    // Beams and probe volume
    let geo = [];
    if (scene.beams) {
      geo = BEAMS.map(beamGeometry);
      ctx.globalCompositeOperation = th.blend;
      BEAMS.forEach((b, i) => drawBeam(b, geo[i], th));
      const pulse = 0.8 + 0.2 * Math.sin(t * 0.02);
      drawSprite(crossSprite, crossX(), CROSS.y * H, 200, 0.10 * pulse * th.glow);
      drawSprite(crossSprite, crossX(), CROSS.y * H, 36, 0.22 * pulse * th.glow);
    }

    // Cursor: aureole, corona, light
    drawCorona(th);
    ctx.globalCompositeOperation = th.blend;
    const light = cursorLight > 0.01 && cursorX !== null;
    if (light && th.halo) drawSprite(cursorSprite, cursorX, cursorY, CURSOR_LIGHT * 2, th.halo * cursorLight);

    let sumR = 0, nR = 0;
    for (const p of particles) {
      if (p.life < 0) continue;
      const frac = p.life / p.maxLife;
      let fade = 1;
      if (p.life < 60) fade = p.life / 60;
      else if (frac > 0.9) fade = (1 - frac) / 0.1;

      const S = 0.4 + 0.75 * p.z;                               // depth scale
      const rw = physR(p);
      const rd = Math.max(0.55, (p.mono ? p.R * 0.5 * AGG_DRAW : p.r) * p.gf * S);
      const blur = Math.min(1, Math.abs(p.z - FOCUS) / 0.45);
      const xs = Math.min(1, (rw * rw) / 6);
      const scatterSize = rd * (8 + blur * 6) + 8;
      ctx.globalCompositeOperation = th.blend;

      // Laser sheets: glow, streak, scattering lobe, diffraction rings, detectors
      for (let i = 0; i < geo.length; i++) {
        const g = geo[i];
        const s = beamExposure(g, p.x, p.y, BEAM_SIGMA) * BEAMS[i].power * xs * fade;
        if (s < 0.01) continue;
        const col = BEAMS[i].color;
        drawSprite(glowSprites[i], p.x, p.y, scatterSize, s * th.glow / (1 + blur));
        if (blur < 0.7) {
          if (p.vx * p.vx + p.vy * p.vy > 0.004) {
            ctx.globalAlpha = Math.min(1, s * 0.75 * th.glow * (1 - blur));
            ctx.strokeStyle = rgba(col, 1);
            ctx.lineWidth = Math.max(0.6, rd * 0.8);
            ctx.beginPath();
            ctx.moveTo(p.x - p.vx * STREAK, p.y - p.vy * STREAK);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
          if (s > 0.12) drawLobe(p.x, p.y, g.angle, rw, (14 + 26 * xs) * S, col, Math.min(0.5, s * 0.5) * th.glow * (1 - blur));
          if (rw > 2.2 && s > 0.15) {
            ctx.strokeStyle = rgba(col, 1);
            ctx.lineWidth = 1;
            for (let k = 0; k < 2; k++) {
              ctx.globalAlpha = s * 0.2 * th.glow / (k + 1);
              ctx.beginPath();
              ctx.arc(p.x, p.y, rd * 1.5 + (k + 0.6) * 36 / rw, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
        if (i === 0) accumulateDetectors(p, s, rw);
      }

      // Light scattered from the cursor; sample the local size for the corona
      if (light) {
        const dx = p.x - cursorX, dy = p.y - cursorY, d2 = dx * dx + dy * dy;
        if (d2 < CURSOR_LIGHT * CURSOR_LIGHT) {
          const f = 1 - Math.sqrt(d2) / CURSOR_LIGHT;
          drawSprite(cursorSprite, p.x, p.y, scatterSize * 0.8, f * f * xs * fade * cursorLight * 0.8 * th.glow / (1 + blur));
          sumR += rw; nR++;
        }
      }

      // Burst particles carry a faint blue glow while they are fresh
      const fresh = p.burst ? clamp((1.3 - p.r) / 1.0, 0, 1) : 0;
      if (fresh > 0) drawSprite(sp.freshGlow, p.x, p.y, 12, 0.10 * fresh * fade * th.glow);

      // Body
      ctx.globalCompositeOperation = 'source-over';
      const zn = Math.min(1, p.z);
      const alpha = fade * th.coreAlpha * (0.18 + 0.38 * zn) * Math.min(1, 0.45 + rw * 0.25);
      if (p.mono && blur < 0.5) {
        const c = Math.cos(p.ang), s = Math.sin(p.ang), k = S * p.gf * AGG_DRAW;
        for (const o of p.mono) {
          drawSprite(sp.soot, p.x + (o.x * c - o.y * s) * k, p.y + (o.x * s + o.y * c) * k, o.r * k * 2.6, alpha * 0.9 + p.flash * 0.4);
        }
      } else if (blur < 0.35) {
        const img = p.kind === 'soot' ? sp.soot : sp.core;
        if (fresh > 0) drawSprite(sp.fresh, p.x, p.y, rd * 2.6, (alpha + 0.15) * fresh);
        drawSprite(img, p.x, p.y, rd * 2.6, (alpha + p.flash * 0.5) * (1 - fresh));
      } else {
        const grow = 1 + blur * (p.z > 1 ? 9 : 3.5);
        drawSprite(sp.bokeh, p.x, p.y, rd * 2.6 * grow, alpha / Math.sqrt(grow) * th.bokeh);
      }
      // Swollen droplets show a refractive rim
      if (p.gf > 1.08 && p.kind === 'drop') drawSprite(sp.droplet, p.x, p.y, rd * 2.8, (p.gf - 1) * 0.7 * fade);

      ctx.globalCompositeOperation = th.blend;
      if (p.fly) {
        const b = p.phase < FLASH_WIDTH ? Math.sin(Math.PI * p.phase / FLASH_WIDTH) ** 2 : 0;
        const k = fade * th.flyGlow / (1 + blur);
        const gs = rd * (14 + blur * 8) + 26;
        drawSprite(sp.flyGlow, p.x, p.y, gs * (0.7 + 0.5 * b), (0.12 + 0.88 * b) * k);
        if (b > 0.02) {
          drawSprite(sp.flyGlow, p.x, p.y, gs * 3, b * 0.12 * k);
          drawSprite(sp.flyCore, p.x, p.y, rd * 3.2 * (1 + blur), b * k);
        }
      }
      if (p.flash > 0.05) {
        const fs = rd * 2.6 * (1 + (1 - p.flash) * 4);
        drawSprite(sp.core, p.x, p.y, fs, p.flash * 0.3);
      }
    }
    if (nR > 3) coronaD += (sumR / nR - coronaD) * 0.05;

    if (scene.beams && W >= 760) drawDetectors(geo[0], th);
    if (scene.plume) drawPlumeSource(th);
    if (scene.sensors) drawSensors(th);
    drawReadout(th);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ── Loop ──
  window.addEventListener('resize', resize);
  resize();
  if (scene.plume) plumeFrame();
  if (scene.sensors) { sampleSensors(); for (const s of sensors) s.v = s.target; }
  loadPM();

  if (reducedMotion) {
    new MutationObserver(render).observe(root, { attributes: true, attributeFilter: ['class'] });
    render();
    return;
  }

  let last = performance.now();
  function loop(now) {
    // rAF timestamps can precede the performance.now() taken at load, so the
    // first dt may be ≤ 0; stepping with it would turn positions into NaN
    const dt = Math.min(3, (now - last) / 16.667);
    last = now;
    if (dt > 0) {
      frame++;
      step(dt);
      if (frame % 3 === 0) coagulate();
    }
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
