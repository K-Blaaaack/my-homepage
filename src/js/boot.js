/**
 * boot.js —— 启动状态机（31 号规格）。
 *
 * 三条铁律：
 *  1. 每个 stage 的 run 必须 await 真实工作，行文案里的数字必须来自实测；
 *  2. 失败可见（红行 + 点击重试，只重跑失败阶段），超时可见（[ WARN ] 放行）；
 *  3. 遮罩消失不依赖任何动画结束事件 —— release() 用固定计时 + display:none 兜底，
 *     且顶层 finally 一定执行，任何异常都不会留下黑屏。
 */

const OK = '> [  OK  ] ';
const FAIL = '> [ FAIL ] ';
const WARN = '> [ WARN ] ';
export const GLOBAL_DEADLINE = 2500;
const FLAVOR_BUDGET = 400;
/** core 阶段「软等待」：超过这个时间只是行文案降级，import 继续跑，到了照常挂载。 */
export const SOFT_KERNEL_WAIT = 3000;

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (win) => new Promise((r) => (win && win.requestAnimationFrame ? win.requestAnimationFrame(() => r()) : setTimeout(r, 16)));

function mark(name, kind, extra) {
  try {
    if (typeof performance === 'undefined') return;
    if (kind === 'measure') performance.measure(name, extra[0], extra[1]);
    else performance.mark(name);
  } catch { /* 忽略 */ }
}

/** 单阶段超时只用于兜底，绝不用于推进进度。 */
function raceTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('超时')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** 内核加载：只发一次，失败重试 1 次；promise 缓存在 ctx 上，绝不重复下载。 */
function loadKernelOnce(ctx) {
  if (ctx.kernelPromise) return ctx.kernelPromise;
  const load = ctx.loadKernel || (() => import('./overlay.js'));
  ctx.kernelPromise = load().catch((err) => {
    ctx.kernelError = err;
    return load();
  });
  return ctx.kernelPromise;
}

/** 已加载脚本的真实字节（PerformanceResourceTiming）；不可得时返回 0。 */
export function scriptKb() {
  try {
    const es = performance.getEntriesByType('resource').filter((e) => /\.js(\?|$)/.test(e.name));
    const bytes = es.reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0);
    return bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0;
  } catch { return 0; }
}

/** 首屏图片：视口内、未懒加载的 img，最多 4 张。 */
export function heroImages(doc = document) {
  const vh = (doc.defaultView && doc.defaultView.innerHeight) || 800;
  return Array.from(doc.querySelectorAll('img'))
    .filter((img) => {
      const r = img.getBoundingClientRect ? img.getBoundingClientRect() : null;
      if (!r) return false;
      if (r.top >= vh || r.bottom <= 0) return false;
      if (img.loading === 'lazy' && !img.complete) return false;
      return true;
    })
    .slice(0, 4);
}

/* ───────────────────────────── 阶段定义 ───────────────────────────── */

export const STAGES = [
  {
    id: 'shell', weight: 5, timeout: 0, label: '终端就绪', kind: 'header',
    line: '> P.R.T.S. NATIVE RHODES ISLAND TERMINAL SERVICE',
    run: async (ctx) => {
      await frame(ctx.win);
      await frame(ctx.win);
      const sheets = (ctx.doc.styleSheets && ctx.doc.styleSheets.length) || 0;
      let signal = '';
      try { signal = ctx.win.getComputedStyle(ctx.doc.documentElement).getPropertyValue('--signal').trim(); } catch { /* 忽略 */ }
      return { detail: 'css ' + sheets + ' sheets' + (signal ? ' · --signal ' + signal : '') };
    },
  },
  {
    id: 'core', weight: 20, timeout: 10000, label: '运行时内核', kind: 'ok',
    applies: (ctx) => ctx.kernelEnabled !== false,
    run: async (ctx) => {
      const t0 = now();
      // 真实网络分包：overlay 是独立 chunk，这里才发出请求。
      // 关键：promise 一旦发出就不再 race 丢弃 —— 慢网络只影响行文案，到了照常挂载。
      const p = loadKernelOnce(ctx);
      p.then((mod) => ctx.onKernelReady && ctx.onKernelReady(mod, t0),
             (err) => ctx.onKernelFail && ctx.onKernelFail(err));
      const settled = await Promise.race([
        p.then(() => 'ok', () => 'fail'),
        sleep(SOFT_KERNEL_WAIT).then(() => 'slow'),
      ]);
      if (settled === 'fail') throw ctx.kernelError || new Error('内核加载失败');
      if (settled === 'slow') return { warn: true, detail: '加载中（慢网络），继续后台加载' };
      const kb = ctx.kernelKb();
      return { detail: (kb > 0 ? kb + ' KB · ' : '') + (now() - t0).toFixed(0) + ' ms' };
    },
  },
  {
    id: 'manifest', weight: 25, timeout: 6000, label: '文章清单', kind: 'ok',
    run: async (ctx) => {
      const t0 = now();
      const res = await fetch(ctx.metaUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const meta = await res.json();
      const list = Array.isArray(meta.articles) ? meta.articles : [];
      const n = list.length || (meta.counts && meta.counts.articles) || 0;
      if (!n) throw new Error('清单为空');
      ctx.meta = meta;
      ctx.store.setData({ meta, metaError: null });

      // 远端清单：独立 chunk + 双源（jsDelivr → raw），失败只降级成 WARN，不阻塞启动
      if (ctx.remoteEnabled !== false) {
        try {
          const remote = ctx.remote || await (ctx.loadRemote ? ctx.loadRemote() : import('./remote.js'));
          ctx.remote = remote;
          const st = await remote.sync({ doc: ctx.doc, meta });
          ctx.remoteState = st;
          ctx.store.setData({ remote: st });
          if (st && st.status !== 'offline') {
            const upd = st.changed ? ' · 更新 ' + st.changed + ' 篇' : '';
            return { detail: n + ' 篇 · 远端 ' + st.remoteCount + ' 篇' + upd + ' · ' + (now() - t0).toFixed(0) + ' ms' };
          }
        } catch (err) { /* 静默降级 */ }
        return { warn: true, detail: '离线缓存 · ' + n + ' 篇' };
      }
      return { detail: n + ' 篇 · ' + (now() - t0).toFixed(0) + ' ms' };
    },
  },
  {
    id: 'index', weight: 15, timeout: 3000, label: '搜索索引', kind: 'ok',
    run: async (ctx) => {
      const res = await fetch(ctx.indexUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const data = JSON.parse(text);
      const docs = Array.isArray(data.docs) ? data.docs : [];
      if (!docs.length) throw new Error('索引为空');
      ctx.index = data;
      ctx.store.setData({ index: data, indexError: null });
      const kb = Math.max(1, Math.round(new TextEncoder().encode(text).byteLength / 1024));
      return { detail: docs.length + ' 条 · ' + kb + ' KB' };
    },
  },
  {
    id: 'media', weight: 20, timeout: 2000, label: '首屏媒体', kind: 'ok',
    applies: (ctx) => ctx.heroImages().length > 0,
    run: async (ctx) => {
      const imgs = ctx.heroImages();
      const t0 = now();
      await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => null) : Promise.resolve(null))));
      return { detail: imgs.length + ' 张 · decode ' + (now() - t0).toFixed(0) + ' ms' };
    },
  },
  {
    id: 'views', weight: 15, timeout: 1000, label: '视图挂载', kind: 'ok',
    applies: (ctx) => ctx.kernelEnabled !== false,
    run: async (ctx) => {
      const t0 = now();
      const views = ctx.mountViews();
      ctx.viewsStageDone = true;
      if (views < 0) return { warn: true, detail: '内核加载中，到达后自动挂载' };
      await frame(ctx.win);
      return { detail: '搜索 / 目录 / 标签 · ' + (now() - t0).toFixed(0) + ' ms', views };
    },
  },
];

/* ───────────────────────────── 纯状态机 ───────────────────────────── */

/**
 * 只跑阶段、只发钩子，不碰 DOM —— 可在 Node 里单测。
 * @param {object} o
 * @param {Array}  o.stages
 * @param {object} o.ctx
 * @param {object} o.hooks  { onStart, onLine(stage,result,ms,progress), onFail(stage,err,index), onDeadline, onEnd }
 * @param {Set}    [o.skip] 已完成、不要重跑的 stage id
 * @param {number} [o.deadlineMs]
 */
export async function runSequence({ stages, ctx, hooks = {}, skip, deadlineMs = GLOBAL_DEADLINE, startIndex = 0 }) {
  const enabled = stages.filter((s) => s.weight > 0 && (!s.applies || s.applies(ctx)));
  const totalWeight = enabled.reduce((n, s) => n + s.weight, 0) || 1;
  const done = new Set(skip || []);
  let doneWeight = enabled.filter((s) => done.has(s.id)).reduce((n, s) => n + s.weight, 0);
  const timings = {};
  const errors = {};
  const t0 = now();
  let degraded = false;
  let timer = null;

  if (deadlineMs > 0 && hooks.onDeadline) {
    timer = setTimeout(() => { degraded = true; hooks.onDeadline(); }, deadlineMs);
  }
  if (hooks.onStart) hooks.onStart(enabled, totalWeight);

  try {
    for (let i = 0; i < enabled.length; i++) {
      const stage = enabled[i];
      if (i < startIndex || done.has(stage.id)) continue;
      const s0 = now();
      mark('boot:' + stage.id + ':start');
      if (hooks.onStage) hooks.onStage(stage);
      try {
        const result = await raceTimeout(Promise.resolve().then(() => stage.run(ctx)), stage.timeout);
        const ms = now() - s0;
        timings[stage.id] = ms;
        mark('boot:' + stage.id + ':end');
        mark('boot:' + stage.id, 'measure', ['boot:' + stage.id + ':start', 'boot:' + stage.id + ':end']);
        done.add(stage.id);
        doneWeight += stage.weight;
        if (hooks.onLine) hooks.onLine(stage, result, ms, Math.min(1, doneWeight / totalWeight));
      } catch (err) {
        const ms = now() - s0;
        const reason = (err && err.message) || String(err);
        errors[stage.id] = reason;
        timings[stage.id] = ms;
        if (hooks.onFail) hooks.onFail(stage, reason, i, done);
        return { ok: false, failed: stage.id, index: i, timings, errors, done, degraded, totalMs: now() - t0 };
      }
    }
    return { ok: true, timings, errors, done, degraded, totalMs: now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
    if (hooks.onEnd) hooks.onEnd();
  }
}

/* ───────────────────────────── DOM 适配层 ───────────────────────────── */

function createTerminal(loader, doc) {
  const body = loader.querySelector('.loader-term-body') || loader.querySelector('#termBody');
  const fill = loader.querySelector('.loader-pbar-fill') || loader.querySelector('#pFill');
  const ptxt = loader.querySelector('.loader-ptxt') || loader.querySelector('#pTxt');
  const slots = body ? Array.from(body.querySelectorAll('.loader-line')) : [];
  const byId = new Map();
  let used = 0;

  if (body && !body.getAttribute('role')) {
    body.setAttribute('role', 'status');
    body.setAttribute('aria-live', 'polite');
  }

  function write(text, cls, stageId) {
    if (!body) return null;
    let el = slots[used];
    used += 1;
    if (!el) {
      el = doc.createElement('div');
      el.className = 'loader-line';
      body.appendChild(el);
    }
    el.className = 'loader-line' + (cls ? ' ' + cls : '');
    el.textContent = text;
    void el.offsetWidth; // 强制回流，让 .show 的过渡真的跑起来
    el.classList.add('show');
    if (stageId) byId.set(stageId, el);
    return el;
  }

  function progress(p) {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    if (fill) fill.style.width = pct + '%';
    if (ptxt) ptxt.textContent = pct + '%';
  }

  function lineFor(id) { return byId.get(id) || null; }

  function retryButton(label, onClick) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cut loader-retry';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    if (body) body.appendChild(btn);
    else loader.appendChild(btn);
    return btn;
  }

  function remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  return { body, write, progress, lineFor, retryButton, remove, count: () => used };
}

/** 幂等兜底：无论谁调用、调用几次，遮罩都不会留在页面上。 */
export function releaseLoader(doc = document) {
  try {
    doc.documentElement.classList.remove('no-js');
    const wrap = doc.getElementById('mainWrap');
    if (wrap) wrap.classList.add('show');
    const loader = doc.getElementById('loader');
    if (!loader) return;
    loader.classList.add('hide');
    loader.setAttribute('aria-hidden', 'true');
    loader.style.pointerEvents = 'none';
    setTimeout(() => { loader.style.display = 'none'; }, 400);
  } catch { /* 忽略 */ }
}

function createRelease({ doc, loader }) {
  let released = false;
  let unblocked = false;

  function unblock() {
    // 失败态：内容可读、可交互，终端面板保留以便重试
    unblocked = true;
    doc.documentElement.classList.remove('no-js');
    const wrap = doc.getElementById('mainWrap');
    if (wrap) wrap.classList.add('show');
    if (!loader) return;
    loader.style.background = 'transparent';
    loader.style.pointerEvents = 'none';
    loader.setAttribute('aria-modal', 'false');
    const panel = loader.querySelector('.loader-terminal');
    if (panel) panel.style.pointerEvents = 'auto';
  }

  function release() {
    if (released) return;
    released = true;
    unblock();
    // 不依赖 transitionend / animationend：固定计时后硬隐藏，动画被跳过也不影响
    releaseLoader(doc);
  }

  return { release, unblock, get released() { return released; }, get unblocked() { return unblocked; } };
}

function readSession(ss, key) {
  try { return ss ? ss.getItem(key) : null; } catch { return null; }
}
function writeSession(ss, key, value) {
  try { if (ss) ss.setItem(key, value); } catch { /* 隐私模式忽略 */ }
}

/**
 * 启动入口。永不抛出；无论成功/失败/超时，遮罩都会离开阻断状态。
 */
export async function boot(opts = {}) {
  const store = opts.store;
  const platform = opts.platform || { reducedMotion: false, platform: 'desktop' };
  const doc = opts.doc || document;
  const win = opts.win || window;
  const params = opts.params || new URLSearchParams(win.location.search);
  const mode = params.get('boot');
  const debug = mode === 'debug';
  const replay = mode === '1' || debug;
  const reduced = !!platform.reducedMotion;
  const kernelEnabled = opts.kernel !== false;

  const loader = doc.getElementById('loader');
  const term = loader ? createTerminal(loader, doc) : null;
  const ctl = createRelease({ doc, loader });

  let ss = opts.session || null;
  if (!ss) { try { ss = win.sessionStorage; } catch { ss = null; } }
  const seen = readSession(ss, 'boot:seen') === '1';
  const failures = Number(readSession(ss, 'boot:failures') || 0);
  const blocked = failures >= 2 && !replay;

  const ctx = {
    store, platform, doc, win,
    meta: null, index: null, kernel: null,
    remote: null, remoteState: null,
    kernelEnabled,
    remoteEnabled: opts.remote !== false,
    loadRemote: opts.loadRemote,
    metaUrl: opts.metaUrl || '/meta.json',
    indexUrl: opts.indexUrl || '/search/index.json',
    loadKernel: opts.loadKernel,
    heroImages: () => heroImages(doc),
    kernelKb: opts.kernelKb || scriptKb,
    viewsMounted: -1,
    viewsStageDone: false,
  };

  /** 幂等挂载：views 阶段与「迟到的内核」谁先到谁挂，只挂一次。未就绪返回 -1。 */
  ctx.mountViews = () => {
    if (!ctx.kernel || typeof ctx.kernel.init !== 'function') return -1;
    if (ctx.viewsMounted >= 0) return ctx.viewsMounted;
    try {
      ctx.viewsMounted = ctx.kernel.init({
        store, platform, meta: ctx.meta, index: ctx.index,
        remote: ctx.remote, remoteState: ctx.remoteState,
      }) || 0;
    } catch (err) {
      ctx.viewsMounted = 0;
      console.error('[boot] kernel.init', err);
    }
    return ctx.viewsMounted;
  };

  store.setBoot({ debug, replay, phase: 'boot', progress: 0, timings: {}, errors: {} });
  mark('boot:start');

  const setProgress = (p) => store.setBoot({ progress: p });
  const record = (id, ms) => store.setBoot((b) => ({ timings: { ...b.timings, [id]: ms } }));

  try {
    /* 1. reduced-motion：不播终端，150ms 交接，后台照常加载 */
    if (reduced) {
      store.setBoot({ phase: 'skipped' });
      await sleep(150);
      ctl.release();
      await silent(ctx, store, { setProgress, record });
      return { ok: true, skipped: 'reduced-motion' };
    }

    /* 2. 冷却：本会话已播过 / 连续失败 2 次 / 无 loader（非首页） */
    if (!loader || !term) {
      await silent(ctx, store, { setProgress, record });
      return { ok: true, skipped: 'no-loader' };
    }
    if (blocked || (seen && !replay)) {
      store.setBoot({ phase: 'skipped' });
      ctl.release();
      await silent(ctx, store, { setProgress, record });
      return { ok: true, skipped: blocked ? 'cooldown-failed' : 'seen' };
    }

    /* 3. 完整序列 */
    writeSession(ss, 'boot:seen', '1');
    if (loader) { loader.setAttribute('aria-busy', 'true'); loader.setAttribute('aria-modal', 'true'); loader.setAttribute('role', 'dialog'); }

    const result = await play(ctx, store, term, ctl, { debug, setProgress, record, ss });

    if (result.ok) {
      writeSession(ss, 'boot:failures', '0');
      store.setBoot({ phase: result.degraded ? 'degraded' : 'ready', totalMs: result.totalMs });
      mark('boot:ready');
      // 调试面板在独立 chunk：只有 ?boot=debug 才多一次请求
      if (debug) await (await import('./debug.js')).debugPanel(term, store, result, STAGES, win);
      // 彩蛋：只在 ready 之后，且总时长 > 300ms 时才播，绝不阻塞遮罩
      if (!result.degraded) await flavor(term, result.totalMs);
      ctl.release();
      return result;
    }

    // 失败：红行 + 重试（已由 play 渲染），遮罩转为非阻断，正文可读
    const n = Number(readSession(ss, 'boot:failures') || 0) + 1;
    writeSession(ss, 'boot:failures', String(n));
    if (n >= 2) writeSession(ss, 'boot:failed', '1');
    store.setBoot({ phase: 'fail', totalMs: result.totalMs });
    return result;
  } catch (err) {
    // 兜底：状态机自身异常也不许留黑屏
    store.setBoot({ phase: 'fail', errors: { boot: (err && err.message) || String(err) } });
    ctl.release();
    return { ok: false, failed: 'boot', error: (err && err.message) || String(err) };
  } finally {
    // 铁律：finally 一定执行。失败态已 unblock（非阻断、可读可点重试），
    // 其余任何路径都必须彻底移除遮罩。
    if (!ctl.released && !ctl.unblocked) ctl.release();
  }
}

/** 静默序列：回访/降级时后台加载数据与覆盖层，不渲染终端。 */
async function silent(ctx, store, { setProgress, record }) {
  ctx.onKernelReady = (mod) => {
    ctx.kernel = mod;
    if (ctx.viewsStageDone && ctx.viewsMounted < 0) ctx.mountViews();
  };
  ctx.onKernelFail = () => {};
  const hooks = {
    onLine: (stage, result, ms, progress) => { setProgress(progress); record(stage.id, ms); },
    onFail: (stage, reason) => {
      store.setBoot((b) => ({ errors: { ...b.errors, [stage.id]: reason }, degraded: true }));
    },
  };
  try {
    return await runSequence({ stages: STAGES, ctx, hooks, deadlineMs: 0 });
  } catch { return { ok: false }; }
}

/** 完整播放：渲染真实行、处理失败重试与全局超时。 */
async function play(ctx, store, term, ctl, { debug, setProgress, record, ss }) {
  const { doc } = ctx;
  let failedIndex = -1;
  let retrying = false;

  const hooks = {
    onLine(stage, result, ms, progress) {
      record(stage.id, ms);
      store.setBoot({ stage: stage.id, progress });
      setProgress(progress);
      term.progress(progress);
      if (stage.kind === 'header') {
        term.write(stage.line || OK + stage.label, '', stage.id);
      } else {
        // result.warn = 远端不可达但本地可用：降级行，不算失败（红色留给真失败）
        const warn = !!(result && result.warn);
        const detail = result && result.detail ? result.detail : ms.toFixed(0) + ' ms';
        term.write((warn ? WARN : OK) + stage.label + ' ' + detail, warn ? 'warn' : '', stage.id);
      }
    },
    onFail(stage, reason, index, done) {
      failedIndex = index;
      store.setBoot((b) => ({ errors: { ...b.errors, [stage.id]: reason } }));
      const line = term.lineFor(stage.id) || term.write(FAIL + stage.label + ' · ' + reason, 'err', stage.id);
      line.className = 'loader-line err show';
      line.textContent = FAIL + stage.label + ' · ' + reason;

      // 失败即降级为非阻断：正文可读，面板仍可点重试
      ctl.unblock();
      const btn = term.retryButton('点击重试', async () => {
        if (retrying) return;
        retrying = true;
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        term.remove(line);
        // 只重跑失败阶段：skip 里是已完成的 id，startIndex 指向失败位置
        const again = await runSequence({ stages: STAGES, ctx, hooks, skip: done, startIndex: failedIndex });
        retrying = false;
        if (again.ok) {
          writeSession(ss, 'boot:failures', '0');
          store.setBoot({ phase: again.degraded ? 'degraded' : 'ready', totalMs: again.totalMs });
          ctl.release();
        } else {
          const n = Number(readSession(ss, 'boot:failures') || 0) + 1;
          writeSession(ss, 'boot:failures', String(n));
        }
      });
      const hint = term.write('> Esc 跳过启动，直接阅读', 'dim');
      hint.dataset.hint = '1';
      if (term.body) term.body.setAttribute('aria-live', 'assertive');
    },
    onDeadline() {
      if (ctl.released) return;
      store.setBoot({ degraded: true, phase: 'degraded' });
      term.write(WARN + '启动超时，先行放行', 'warn');
      ctl.release();
    },
  };

  /* 慢网络兜底：core 只做了「软等待」，chunk 真正到达时在这里补挂载，不刷新也能用 */
  ctx.onKernelReady = (mod, t0) => {
    ctx.kernel = mod;
    if (!ctx.viewsStageDone || ctx.viewsMounted >= 0) return; // 正常路径由 views 阶段挂
    const v = ctx.mountViews();
    if (v < 0) return;
    const kb = ctx.kernelKb();
    const el = term.lineFor('core');
    if (el) {
      el.className = 'loader-line show';
      el.textContent = OK + '运行时内核 ' + (kb > 0 ? kb + ' KB · ' : '') + (now() - t0).toFixed(0) + ' ms';
    }
    term.write(OK + '视图挂载 搜索 / 目录 / 标签 · 后台完成', '', 'views');
    store.setBoot({ kernel: 'late', views: v });
  };

  /* 迟到的失败（软等待已过才 reject）：补红行 + 重试；早失败由 onFail 统一处理 */
  ctx.onKernelFail = (err) => {
    ctx.kernelError = err;
    if (!ctx.viewsStageDone) return;
    const reason = (err && err.message) || String(err);
    store.setBoot((b) => ({ errors: { ...b.errors, core: reason } }));
    const el = term.lineFor('core');
    if (el) { el.className = 'loader-line err show'; el.textContent = FAIL + '运行时内核 · ' + reason; }
    ctl.unblock();
    term.retryButton('点击重试', async () => {
      ctx.kernelPromise = null;
      try {
        ctx.kernel = await loadKernelOnce(ctx);
        ctx.viewsStageDone = true;
        if (ctx.mountViews() >= 0) { ctl.release(); store.setBoot({ phase: 'ready' }); }
      } catch { /* 仍失败：保持红行 */ }
    });
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && !ctl.released) {
      e.preventDefault();
      ctl.release();
      store.setBoot({ phase: 'skipped' });
    }
  };
  doc.addEventListener('keydown', onKey, true);

  try {
    const result = await runSequence({ stages: STAGES, ctx, hooks, deadlineMs: GLOBAL_DEADLINE });
    if (debug) store.setBoot({ timings: result.timings });
    return result;
  } finally {
    doc.removeEventListener('keydown', onKey, true);
    if (term.body) term.body.removeAttribute('aria-live');
  }
}

/** ready 之后的氛围文案：不阻塞遮罩，>300ms 才播，预算 400ms。 */
async function flavor(term, totalMs) {
  if (totalMs < 300) return;
  const t0 = now();
  const lines = [
    ['> 欢迎回来，博士', 'gold'],
    ['> K-BLACK TERMINAL 已就绪', ''],
    ['> ACCESS GRANTED', ''],
    ['> [????] Dr.预言家，不准忘記我', 'red'],
  ];
  for (const [text, cls] of lines) {
    if (now() - t0 > FLAVOR_BUDGET) break;
    term.write(text, cls);
    await sleep(80);
  }
}