/**
 * tetra.js —— 首页主视觉：正四面体粒子场。
 *
 * 几何来自 Wry-Zen/Strata 的正四面体；粒子行为移植自 rotating-polygon.html：
 *   散开（放大 + 旋开 + 错峰延迟）→ 收拢成棱 → 自转 → 可拖拽
 * 每颗粒子先绕棱线散开一点，整条棱就是一条松散的粒子带；亮度/大小按深度分档，
 * 指针靠近时被推开并弹簧回位。
 *
 * 与本站的连接点只有两个：store.boot.phase（fail 转红）与 platform（reducedMotion / pointer）。
 * 不 import 任何模块 —— 由入口在首页动态 import，且仅首页会请求这个分包。
 */

const TAU = Math.PI * 2;

/* ---------- 几何（与 Strata 同值） ---------- */
const R3 = (2 * Math.SQRT2) / 3;
const DIST = 5; // 视距，5 ≈ 弱透视
const ANGLES = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI) / 3, -Math.PI / 2 + (4 * Math.PI) / 3];
const VERTICES = [
  ...ANGLES.map((a) => ({ x: R3 * Math.cos(a), y: R3 * Math.sin(a), z: -1 / 3 })),
  { x: 0, y: 0, z: 1 },
];
const EDGES = [[0, 1], [1, 2], [2, 0], [3, 0], [3, 1], [3, 2]];

const GATHER_MS = 2500; // 最晚一颗（delay 0.55 + dur 1.9）收拢完
const SPIN = 0.3;       // 自转角速度 rad/s
const PER_EDGE = 200;   // 6 条棱共 1200 颗：聚集后要接近连续粒子带
const LEVELS = 12;      // 按亮度分 12 档批量填充
const ORDER = ['tetra', 'cone', 'cube']; // 形体循环
const HOLD_MS = 3600;   // 每个形体停留 3.6s
const MORPH_MS = 2000;  // 0.7s 外抛 + 1.3s 收拢（sin 相位前移）

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 把 tokens 里的 #rgb / #rrggbb / rgb() / rgba() 解析成通道数组。 */
function channels(raw) {
  const s = String(raw || '').trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3) return [p[0] || 0, p[1] || 0, p[2] || 0];
  }
  return null;
}

const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

export function init({ doc = document, win = window, platform = {}, store = null } = {}) {
  const hero = doc.querySelector('.hero');
  if (!hero || hero.dataset.tetra) return null;

  const canvas = doc.createElement('canvas');
  canvas.className = 'hero-tetra';
  canvas.setAttribute('aria-hidden', 'true');
  // 放在 .hero-bg 之后：径向压暗层不再吃掉粒子亮度（仍在 .hero-content 之下）
  const bg = hero.querySelector('.hero-bg');
  hero.insertBefore(canvas, bg ? bg.nextSibling : hero.firstChild);
  hero.dataset.tetra = 'on';

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    delete hero.dataset.tetra;
    return null;
  }

  const reduced = !!platform.reducedMotion;
  const coarse = platform.pointer !== 'fine';

  /* 颜色一律来自 tokens，不写死色值（与 check-tokens 同一条规矩） */
  let style = null;
  try { style = win.getComputedStyle(doc.documentElement); } catch { /* 忽略 */ }
  const token = (name) => (style && channels(style.getPropertyValue(name))) || null;
  const COL = {
    paper: token('--paper') || [244, 246, 246],
    signal: token('--signal') || [24, 209, 255],
    danger: token('--danger') || [224, 82, 79],
  };

  /* ---------- 尺寸 ---------- */
  let W = 0;
  let H = 0;
  let cx = 0;
  let cy = 0;
  let R = 150;
  let SCALE = 1;
  let HIT = 120;
  let REACH = 160;
  let PUSH = 55;

  /* ---------- 粒子 + 形体（正四面体 / 圆锥 / 正方体） ---------- */
  const PCOUNT = EDGES.length * PER_EDGE; // 1200 颗
  const ex = new Float32Array(PCOUNT);
  const ey = new Float32Array(PCOUNT);
  const ez = new Float32Array(PCOUNT);
  const jx = new Float32Array(PCOUNT);
  const jy = new Float32Array(PCOUNT);
  const jz = new Float32Array(PCOUNT);
  const jw = new Float32Array(PCOUNT);
  const ph = new Float32Array(PCOUNT);
  const grain = new Float32Array(PCOUNT);
  const mrand = new Float32Array(PCOUNT);
  const spread = new Float32Array(PCOUNT);
  const turn = new Float32Array(PCOUNT);
  const delay = new Float32Array(PCOUNT);
  const dur = new Float32Array(PCOUNT);
  const offX = new Float32Array(PCOUNT);
  const offY = new Float32Array(PCOUNT);
  const buckets = Array.from({ length: LEVELS }, () => []);

  /** 把棱段/顶点归一化到 |v|max=1，再按总长度把 PCOUNT 颗粒子均分。 */
  function makeShape(segments) {
    let max = 0;
    for (const [a, b] of segments) {
      max = Math.max(max, Math.hypot(a[0], a[1], a[2]), Math.hypot(b[0], b[1], b[2]));
    }
    const scale = max > 0 ? 1 / max : 1;
    const segs = segments.map(([a, b]) => [
      [a[0] * scale, a[1] * scale, a[2] * scale],
      [b[0] * scale, b[1] * scale, b[2] * scale],
    ]);
    const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    const total = lens.reduce((n, v) => n + v, 0) || 1;
    const pos = new Float32Array(PCOUNT * 3);
    let seg = 0;
    let cum = lens[0] || 0;
    for (let i = 0; i < PCOUNT; i++) {
      const u = ((i + 0.5) / PCOUNT) * total; // 稳定索引映射
      while (u > cum && seg < segs.length - 1) {
        seg++;
        cum += lens[seg] || 0;
      }
      const prev = cum - (lens[seg] || 0);
      const f = lens[seg] ? (u - prev) / lens[seg] : 0;
      const [a, b] = segs[seg];
      pos[i * 3] = a[0] + (b[0] - a[0]) * f;
      pos[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
      pos[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    }
    return { pos };
  }

  const SHAPES = (() => {
    // 正四面体：6 棱
    const tetraSegs = EDGES.map(([a, b]) => [
      [VERTICES[a].x, VERTICES[a].y, VERTICES[a].z],
      [VERTICES[b].x, VERTICES[b].y, VERTICES[b].z],
    ]);

    // 圆锥：底圆（48 段）+ 12 条母线
    const r0 = 0.78;
    const h0 = 1.35;
    const baseN = 48;
    const genN = 12;
    const apex = [0, h0 / 2, 0];
    const rim = [];
    for (let i = 0; i < baseN; i++) {
      const a = (i / baseN) * TAU;
      rim.push([r0 * Math.cos(a), -h0 / 2, r0 * Math.sin(a)]);
    }
    const coneSegs = [];
    for (let i = 0; i < baseN; i++) coneSegs.push([rim[i], rim[(i + 1) % baseN]]);
    for (let k = 0; k < genN; k++) coneSegs.push([apex, rim[Math.round((k * baseN) / genN) % baseN]]);

    // 正方体：12 棱
    const corners = [];
    for (let i = 0; i < 8; i++) {
      corners.push([i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5]);
    }
    const cubeSegs = [];
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        const d = i ^ j;
        if ((d & (d - 1)) === 0) cubeSegs.push([corners[i], corners[j]]);
      }
    }

    return {
      tetra: makeShape(tetraSegs),
      cone: makeShape(coneSegs),
      cube: makeShape(cubeSegs),
    };
  })();

  let burstAt = 0; // 开场即从散开状态收拢
  (function seedParticles() {
    const t = SHAPES.tetra.pos;
    for (let i = 0; i < PCOUNT; i++) {
      ex[i] = t[i * 3];
      ey[i] = t[i * 3 + 1];
      ez[i] = t[i * 3 + 2];
      const u = Math.random() * 2 - 1;
      const th = Math.random() * TAU;
      const sr = Math.sqrt(1 - u * u);
      jx[i] = sr * Math.cos(th);
      jy[i] = sr * Math.sin(th);
      jz[i] = u;
      jw[i] = 0.0025 + Math.pow(Math.random(), 1.8) * 0.012; // 棱上的散开半径（收紧，别太散）
      ph[i] = Math.random() * TAU;
      grain[i] = 0.72 + Math.random() * 0.62;
      mrand[i] = 0.35 + Math.random() * 0.9; // morph 外抛随机量
      // 与参考 demo 同分布：先放大、旋开，再错峰收拢
      spread[i] = 1.55 + Math.random() * 0.85;
      turn[i] = 0.45 + Math.random() * 0.9;
      delay[i] = Math.random() * 0.55;
      dur[i] = 1.15 + Math.random() * 0.75;
    }
  })();

  function resize() {
    const w = hero.clientWidth || win.innerWidth || 0;
    const h = hero.clientHeight || win.innerHeight || 0;
    if (!w || !h) return;
    const dpr = Math.min(win.devicePixelRatio || 1, 2);
    W = w;
    H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 大屏：占右半区（50%→100%）并居中。1.1547 是正四面体旋转时的最大投影半径
    // （f(z)=(1-z²)^.5·D/(D-z) 在 z=1/D 取极值，×SCALE/R≈1.131），
    // 据此反推半径：转到任何角度都不出右半区，也不钻到顶栏下面。
    // 图形允许压到标题上，但标题层级更高（.hero-content z=1 > .hero-tetra z=0）。
    if (w >= 1280) {
      const margin = 28;
      const navSafe = 56 + 12; // 顶栏高度 + 呼吸位
      const byWidth = (w * 0.5 - margin * 2) / 2.31; // 2.31 = 2 × 1.1547
      const byHeight = (h * 0.5 - navSafe) / 1.1547;
      R = Math.max(110, Math.min(360, Math.min(byWidth, byHeight)));
      cx = w * 0.75;
      cy = h * 0.5;
    } else {
      // 窄屏 / 竖屏：居中放在标题上方，半径同时受宽高约束
      R = Math.max(84, Math.min(190, Math.min(w * 0.32, h * 0.23)));
      R = Math.min(R, (w - 32) / 2.84);
      cx = w * 0.5;
      cy = h * 0.355;
    }
    // 与原实现同式：让底面投影半径精确等于 R
    SCALE = (R * (DIST + 1 / 3)) / (R3 * DIST);
    HIT = Math.max(90, R * 1.25);
    REACH = R * 0.65; // 指针影响半径
    PUSH = R * 0.22;  // 冲量基准（实际位移限幅 ±3×）
  }

  /* ---------- 状态 ---------- */
  const fast = doc.documentElement.classList.contains('prts-skip'); // 本会话已看过启动序列：不等 loader
  let state = reduced ? 'static' : 'gather';
  let current = 'tetra';
  let next = 'cone';
  let shapeIdx = 0;
  let holdAt = 0;
  let morphAt = 0;
  let morphT = 0;
  let toShape = SHAPES.tetra;
  const fromX = new Float32Array(PCOUNT);
  const fromY = new Float32Array(PCOUNT);
  const fromZ = new Float32Array(PCOUNT);
  let clock = 0; // 只在可见时累加的虚拟时钟（暂停/后台不推进）
  let failed = false;
  let failT = 0;
  // 初始姿态与参考 demo 同角度；收拢完成后从这里开始自转
  let ax = -0.32;
  let ay = 0.34;
  let vx = 0;
  let vy = 0; // 参考 demo：从 0 渐加速到 0.3
  let dragging = false;
  let moved = 0;
  let lx = 0;
  let ly = 0;
  let prevPX = -9999;
  let prevPY = -9999;
  const pointer = { x: -9999, y: -9999, active: false };
  let running = false;
  let visible = true;
  let gate = reduced || fast;
  let raf = 0;
  let lastTs = 0;

  function phaseOf(st) {
    const p = st && st.boot && st.boot.phase;
    failed = p === 'fail';
  }
  if (store) {
    phaseOf(store.state);
    store.subscribe((s, prev) => {
      if (s.boot.phase !== prev.boot.phase) phaseOf(s);
    });
  }

  /* ---------- 绘制 ---------- */
  /** 粒子场：亮度/大小按深度分 12 档批量填充，492/768 颗也只有 12 次 fill。 */
  function drawParticles(dt) {
    for (let l = 0; l < LEVELS; l++) buckets[l].length = 0;

    const cX = Math.cos(ax);
    const sX = Math.sin(ax);
    const cY = Math.cos(ay);
    const sY = Math.sin(ay);
    const age = (clock - burstAt) / 1000;
    const tsec = clock / 1000;
    const dtSec = (dt || 0) / 1000;
    const decay = Math.exp(-3.0 * dtSec);
    let pdx = 0;
    let pdy = 0;
    let speed = 0;
    if (pointer.active) {
      pdx = pointer.x - prevPX;
      pdy = pointer.y - prevPY;
      speed = Math.min(1, Math.sqrt(pdx * pdx + pdy * pdy) / 12);
    }
    prevPX = pointer.x;
    prevPY = pointer.y;
    const pushing = pointer.active && !dragging && !coarse && speed > 0.02;
    const cap = PUSH * 3;
    const reach2 = REACH * REACH;
    const tint = failT;

    for (let i = 0; i < PCOUNT; i++) {
      // 每颗粒子绕棱线散开一点，棱就成了一条松散的粒子带
      const wob = 0.88 + 0.12 * Math.sin(tsec * 0.9 + ph[i]);
      const jr = jw[i] * wob;
      const x0 = ex[i] + jx[i] * jr;
      const y0 = ey[i] + jy[i] * jr;
      const z0 = ez[i] + jz[i] * jr;

      // 绕 X（俯仰）→ 绕 Y（偏航）
      const y1 = y0 * cX - z0 * sX;
      const z1 = y0 * sX + z0 * cX;
      const x2 = x0 * cY - z1 * sY;
      const z2 = x0 * sY + z1 * cY;

      const scale = (DIST / (DIST - z2)) * SCALE;
      let X = cx + x2 * scale;
      let Y = cy + y1 * scale;

      // 收拢：先放大并旋开，再错峰缓动回棱上
      const p = age <= delay[i] ? 0 : clamp01((age - delay[i]) / dur[i]);
      const e = p >= 1 ? 1 : easeOut(p);
      const kk = 1 - e;
      if (kk > 0.0005) {
        const a = turn[i] * kk;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const sc = 1 + (spread[i] - 1) * kk;
        const dx = X - cx;
        const dy = Y - cy;
        X = cx + (dx * ca - dy * sa) * sc;
        Y = cy + (dx * sa + dy * ca) * sc;
      }

      // 指针干涉：只在指针移动时给冲量（径向 + 切向），停手后指数回弹。
      // 旧的“静态目标位移”会在指针停住时留一个坑，看起来像鼓包。
      if (pushing) {
        const mx = X - pointer.x;
        const my = Y - pointer.y;
        const d2 = mx * mx + my * my;
        if (d2 < reach2) {
          const d = Math.sqrt(d2) || 1;
          const f = 1 - d / REACH;
          const imp = f * f * PUSH * 1.8 * speed * (0.6 + Math.random() * 0.8);
          offX[i] = clamp(offX[i] + (mx / d) * imp - (my / d) * imp * 0.45, -cap, cap);
          offY[i] = clamp(offY[i] + (my / d) * imp + (mx / d) * imp * 0.45, -cap, cap);
        }
      }
      offX[i] *= decay;
      offY[i] *= decay;
      X += offX[i];
      Y += offY[i];

      // 亮度/大小按深度分档；被推开的粒子略提亮，干涉才看得出来
      const kick = Math.min(1, Math.sqrt(offX[i] * offX[i] + offY[i] * offY[i]) / PUSH);
      const depth = clamp01((z2 + 1) / 2);
      const bright = clamp01((0.2 + 0.8 * depth) * (0.4 + 0.6 * e) + 0.3 * kick);
      const lv = Math.min(LEVELS - 1, Math.max(0, (bright * (LEVELS - 1) + 0.5) | 0));
      const size = Math.min(scale / SCALE, 1.18) * grain[i] * 1.9;
      buckets[lv].push(X, Y, size);
    }

    for (let l = 0; l < LEVELS; l++) {
      const arr = buckets[l];
      if (!arr.length) continue;
      const d = l / (LEVELS - 1);
      const base = 0.4 + 0.55 * d;
      // 近处 paper 白，远处/背面混向 signal 青；fail 时两者都混红
      const core = mix(mix(COL.paper, COL.signal, 0.15 + 0.45 * (1 - d)), COL.danger, tint);

      // 粒子芯（不要青色辉光层）
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) {
        const r = base * arr[i + 2];
        ctx.moveTo(arr[i] + r, arr[i + 1]);
        ctx.arc(arr[i], arr[i + 1], r, 0, TAU);
      }
      ctx.fillStyle = rgba(core, 0.3 + 0.7 * d);
      ctx.fill();
    }
  }

  function draw(dt) {
    // 收拢期粒子会散到包围盒外，直接清全画布
    ctx.clearRect(0, 0, W, H);
    drawParticles(dt);
  }

  function updateRotation(dt) {
    const s = dt / 1000;
    vy += (SPIN - vy) * (1 - Math.exp(-1.6 * s)); // 松手后惯性回落到常速自转
    vx *= Math.exp(-2.6 * s);
    ay += vy * s;
    ax += vx * s + Math.sin(clock / 1000 * 0.42) * 0.05 * s; // 极轻的摇摆
  }

  function beginMorph(name) {
    fromX.set(ex);
    fromY.set(ey);
    fromZ.set(ez);
    toShape = SHAPES[name];
    next = name;
    morphT = 0;
    morphAt = clock;
    for (let i = 0; i < PCOUNT; i++) {
      offX[i] = 0;
      offY[i] = 0;
    }
    state = 'morph';
  }

  /** 3D morph：from→to 插值 + 沿径向的外抛（t=0/1 为零，全程连续）。 */
  function morphTo(t) {
    const e = easeInOut(t);
    const peak = Math.sin(Math.PI * Math.pow(t, 0.7)); // 0.74s 到峰值，随后收拢
    const pos = toShape.pos;
    for (let i = 0; i < PCOUNT; i++) {
      const bx = fromX[i] + (pos[i * 3] - fromX[i]) * e;
      const by = fromY[i] + (pos[i * 3 + 1] - fromY[i]) * e;
      const bz = fromZ[i] + (pos[i * 3 + 2] - fromZ[i]) * e;
      const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const d = peak * 0.35 * mrand[i];
      ex[i] = bx + (bx / len) * d;
      ey[i] = by + (by / len) * d;
      ez[i] = bz + (bz / len) * d;
    }
  }

  function step(dt) {
    clock += dt;
    failT += ((failed ? 0.9 : 0) - failT) * (1 - Math.exp(-6 * (dt / 1000)));
    if (!dragging) updateRotation(dt); // 收拢/停留/变形期间都继续自转

    if (state === 'gather') {
      if (clock - burstAt >= GATHER_MS) {
        state = 'rotate';
        holdAt = clock;
      }
    } else if (state === 'rotate') {
      if (clock - holdAt >= HOLD_MS) {
        shapeIdx = (shapeIdx + 1) % ORDER.length;
        beginMorph(ORDER[shapeIdx]);
      }
    } else if (state === 'morph') {
      morphT = clamp01((clock - morphAt) / MORPH_MS);
      morphTo(morphT);
      if (morphT >= 1) {
        current = next;
        canvas.dataset.shape = current;
        state = 'rotate';
        holdAt = clock;
      }
    }

    if (canvas.dataset.state !== state) canvas.dataset.state = state;
  }

  /** 终端遮罩退场（.loader.hide / .main-wrap.show / 本会话已启动）之前不推进动画。 */
  function gateOpen() {
    if (reduced || fast) return true;
    const loader = doc.getElementById('loader');
    const wrap = doc.getElementById('mainWrap');
    if (!loader) return true;
    return loader.classList.contains('hide') || !!(wrap && wrap.classList.contains('show'));
  }

  function tick(ts) {
    raf = 0;
    if (!running) return;
    if (!gate) {
      if (!gateOpen()) {
        raf = win.requestAnimationFrame(tick);
        return;
      }
      gate = true;
    }
    // fast（本会话已看过启动序列）时 gate 一开始就是 true，这里补首次淡入
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
    const dt = lastTs ? Math.min(50, ts - lastTs) : 16.7;
    lastTs = ts;
    step(dt);
    draw(dt);
    raf = win.requestAnimationFrame(tick);
  }

  function play() {
    if (running || reduced) return;
    running = true;
    lastTs = 0;
    raf = win.requestAnimationFrame(tick);
  }

  function pause() {
    running = false;
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    prevPX = pointer.x;
    prevPY = pointer.y;
  }

  /* ---------- 交互：拖动旋转 + 指针推开 ---------- */
  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - r.left - cx;
    const dy = e.clientY - r.top - cy;
    return dx * dx + dy * dy <= HIT * HIT;
  };

  if (!reduced) {
    // 悬停推开：在 window 上取坐标，标题上方也能影响粒子
    win.addEventListener('pointermove', (e) => {
      if (coarse) return;
      const r = canvas.getBoundingClientRect();
      if (!pointer.active) {
        prevPX = e.clientX - r.left;
        prevPY = e.clientY - r.top;
      }
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.active = pointer.x >= 0 && pointer.x <= r.width && pointer.y >= 0 && pointer.y <= r.height;
    }, { passive: true });
    doc.addEventListener('pointerout', (e) => { if (!e.relatedTarget) pointer.active = false; });

    // 拖动：在 hero 上收事件，标题压住的那半块图形也能抓；touch-action:pan-y 保证手机竖滑仍能滚页面
    hero.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !hit(e)) return;
      const t = e.target;
      if (t && t.closest && t.closest('a,button')) return; // CTA 等交互元素优先
      dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      pointer.active = false;
      hero.style.cursor = 'grabbing';
      hero.setPointerCapture?.(e.pointerId);
      if (e.pointerType === 'mouse') e.preventDefault();
    }, { passive: false });

    hero.addEventListener('pointermove', (e) => {
      if (!dragging) {
        if (!coarse) hero.style.cursor = hit(e) ? 'grab' : 'default';
        return;
      }
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      lx = e.clientX;
      ly = e.clientY;
      ay += dx * 0.008;
      ax += dy * 0.008;
      vy = Math.max(-8, Math.min(8, dx * 0.27));
      vx = Math.max(-8, Math.min(8, dy * 0.27));
      if (e.pointerType === 'mouse') e.preventDefault();
    }, { passive: false });

    const endDrag = (e) => {
      if (!dragging) return;
      const tap = moved < 5; // 参考 demo：轻点（几乎没移动）重播散开→收拢
      dragging = false;
      hero.releasePointerCapture?.(e.pointerId);
      hero.style.cursor = hit(e) ? 'grab' : 'default';
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      prevPX = pointer.x;
      prevPY = pointer.y;
      if (tap) replay();
    };
    hero.addEventListener('pointerup', endDrag);
    hero.addEventListener('pointercancel', endDrag);
    hero.addEventListener('pointerleave', () => { if (!dragging) hero.style.cursor = 'default'; });

    if ('IntersectionObserver' in win) {
      const io = new win.IntersectionObserver((entries) => {
        const e = entries[0];
        visible = !!e && e.isIntersecting;
        if (visible) play();
        else pause();
      }, { threshold: 0 });
      io.observe(hero);
    } else {
      visible = true;
    }

    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) pause();
      else if (visible) play();
    });
  }

  function replay() {
    if (state === 'morph') return; // morph 中 tap 不重播、也不换形
    for (let i = 0; i < PCOUNT; i++) {
      spread[i] = 1.55 + Math.random() * 0.85;
      turn[i] = 0.45 + Math.random() * 0.9;
      delay[i] = Math.random() * 0.55;
      dur[i] = 1.15 + Math.random() * 0.75;
      offX[i] = 0;
      offY[i] = 0;
    }
    burstAt = clock;
    state = 'gather';
  }

  if ('ResizeObserver' in win) {
    new win.ResizeObserver(() => {
      resize();
      if (!running) draw(0);
    }).observe(hero);
  } else {
    win.addEventListener('resize', () => {
      resize();
      if (!running) draw(0);
    });
  }

  resize();
  canvas.dataset.state = state;
  canvas.dataset.shape = current;

  if (reduced) {
    state = 'static';
    burstAt = -1e9;
    draw(0);
    canvas.classList.add('on');
  } else {
    if (visible) play();
  }

  return { canvas, get state() { return state; }, destroy: pause };
}

export default { init };
