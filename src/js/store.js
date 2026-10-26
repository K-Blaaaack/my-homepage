/**
 * store.js —— 状态层。纯逻辑，零 DOM、零请求。
 * 视图（overlay / boot / 平台层）各自 subscribe，只读 state，不改 state。
 */

const boot0 = () => ({
  phase: 'idle',      // idle | boot | ready | degraded | fail | skipped
  progress: 0,        // 0..1，Σ已完成权重 / Σ启用权重
  stage: null,        // 当前阶段 id
  debug: false,
  replay: false,
  degraded: false,
  timings: {},        // { [stageId]: ms }
  errors: {},         // { [stageId]: string }
  totalMs: 0,
});

const search0 = () => ({
  open: false, query: '', active: 0, results: [], total: 0,
  source: 'index',    // index | manifest | none
  status: 'idle',     // idle | typing | ready | empty | degraded
});

export function createStore(seed = {}) {
  let state = {
    boot: boot0(),
    overlays: [],     // 覆盖层栈：['search','toc']
    search: search0(),
    toc: { open: false, activeId: '', count: 0 },
    data: { meta: null, index: null, metaError: null, indexError: null },
    prefs: { platform: 'desktop', pointer: 'fine', reducedMotion: false, connection: null, kernel: true },
    ...seed,
  };

  const subs = new Set();
  let depth = 0;
  let dirty = false;

  function notify(prev) {
    if (depth > 0) { dirty = true; return; }
    for (const fn of Array.from(subs)) {
      // 单个订阅者异常不得影响其它订阅者，更不得打断启动序列
      try { fn(state, prev); } catch (err) { if (typeof console !== 'undefined') console.error('[store] subscriber', err); }
    }
  }

  function commit(next) {
    if (next === state) return state;
    const prev = state;
    state = next;
    notify(prev);
    return state;
  }

  function slice(key, patch) {
    const base = state[key] || {};
    const next = typeof patch === 'function' ? patch(base) : patch;
    return commit({ ...state, [key]: { ...base, ...next } });
  }

  return {
    get state() { return state; },
    get() { return state; },

    /** 订阅；返回退订函数。回调签名 (state, prevState)。 */
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /** 顶层浅合并；patch 可以是对象或 (state)=>patch。 */
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      if (!next) return state;
      return commit({ ...state, ...next });
    },

    /** 合并某个 slice。 */
    slice,

    /** 批量更新：同一批次只通知一次。 */
    batch(fn) {
      depth++;
      try { return fn(); } finally {
        depth--;
        if (depth === 0 && dirty) { dirty = false; notify(state); }
      }
    },

    setBoot: (patch) => slice('boot', patch),
    setSearch: (patch) => slice('search', patch),
    setToc: (patch) => slice('toc', patch),
    setData: (patch) => slice('data', patch),
    setPrefs: (patch) => slice('prefs', patch),

    openOverlay(id) {
      if (state.overlays.includes(id)) return state;
      return commit({ ...state, overlays: [...state.overlays, id] });
    },
    closeOverlay(id) {
      if (!state.overlays.includes(id)) return state;
      return commit({ ...state, overlays: state.overlays.filter((x) => x !== id) });
    },
    topOverlay() { return state.overlays[state.overlays.length - 1] || null; },
  };
}
