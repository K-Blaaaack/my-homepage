/**
 * remote.js —— 运行时远端同步层（独立动态 chunk，只在 boot 的 manifest 阶段被 import）。
 *
 * 三条底线：
 *  1. 远端失败/超时（2s）一律静默降级为 offline，绝不阻塞启动与正文；
 *  2. 列表只增不减：远端比本地少时不动，避免构建期刚发版被旧缓存覆盖；
 *  3. markdown / hljs 只在「404 页命中未构建的新文章」时才 import，不进入口包。
 */

// 文章必须实时：gh raw 是实时源（branch head），排第一；jsDelivr 只做兜底。
const DEFAULT_PRIMARY = 'https://raw.githubusercontent.com/K-Blaaaack/articles/main';
const DEFAULT_FALLBACK = 'https://cdn.jsdelivr.net/gh/K-Blaaaack/articles@main';
const isRaw = (u) => /raw\.githubusercontent\.com/i.test(String(u || ''));
const SHIFT = 8 * 3600 * 1000;
const trimBase = (v) => String(v || '').trim().replace(/\/+$/, '');

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const pad = (n) => String(n).padStart(2, '0');

/** 与构建期 build/config.mjs 的 monthPath/dayPath 同一口径（+08:00 固定偏移）。 */
const shifted = (date) => {
  const d = date ? new Date(date) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  d.setTime(d.getTime() + SHIFT);
  return d;
};
export function monthPath(date) {
  const d = shifted(date);
  return d ? d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) : '';
}
export function dayPath(date) {
  const d = shifted(date);
  return d ? d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) : '';
}

let state = {
  status: 'idle',      // idle | same | stale | offline
  localCount: 0,
  remoteCount: 0,
  articles: [],
  fetchedAt: 0,
  base: '',            // 上次成功的基址（记住，后续 md / 图片都用它）
  tried: [],           // 本次尝试过的基址
  error: null,
  ms: 0,
};
let mounted = false;
let refreshing = false;
let offlineLogged = false;

export function getRemoteState() { return state; }

/**
 * 双源：gh raw（实时）永远排第一，jsDelivr 兜底。
 * 两个属性都读，谁像 raw 谁优先 —— builder 给的顺序不影响实时性。
 */
export function contentBases(doc = document) {
  let a = '';
  let b = '';
  try {
    const el = doc && doc.documentElement;
    if (el) {
      a = trimBase(el.getAttribute('data-content-base'));
      b = trimBase(el.getAttribute('data-content-fallback'));
    }
  } catch { /* 忽略 */ }
  const list = [a, b].filter(Boolean);
  const raw = list.filter(isRaw)[0] || '';
  const rest = list.filter((u) => u !== raw);
  const primary = raw || rest[0] || DEFAULT_PRIMARY;
  const others = list.filter((u) => u !== primary);
  let fallback = others[0] || (primary === DEFAULT_PRIMARY ? DEFAULT_FALLBACK : DEFAULT_PRIMARY);
  if (fallback === primary) fallback = '';
  return { primary, fallback };
}

/** 当前实际使用的基址：优先上次成功的那一个。 */
export function contentBase(doc = document) {
  if (state.base) return state.base;
  return contentBases(doc).primary;
}

/* ───────────────────────── 纯函数（可单测） ───────────────────────── */

/** 极简 YAML front matter 解析：标量 / 行内数组 / 块数组 / 引号 / 布尔。 */
export function parseYamlLite(raw) {
  const out = {};
  let key = null;
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (!v) { out[key] = []; continue; }
    if (/^\[.*\]$/.test(v)) {
      out[key] = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      continue;
    }
    out[key] = coerce(v);
  }
  return out;
}

function unquote(s) {
  const v = String(s).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}
function coerce(v) {
  const s = unquote(v);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  return s;
}

export function parseFrontMatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  return { data: parseYamlLite(m[1]), body: src.slice(m[0].length) };
}

export function sortByDate(articles) {
  return (articles || []).slice().sort((a, b) => {
    const ta = Date.parse(a && a.date) || 0;
    const tb = Date.parse(b && b.date) || 0;
    return tb - ta;
  });
}

/**
 * 比对口径：文章数量 + 最新文章 slug（generated_at 会因 Actions 抖动，不参与判断）。
 * 只增不减：远端少于本地 → same。
 */
export function compareMeta(localArticles, remoteArticles) {
  const l = localArticles || [];
  const r = remoteArticles || [];
  const localCount = l.length;
  const remoteCount = r.length;
  const newestLocal = l[0] ? String(l[0].slug || '') : '';
  const newestRemote = r[0] ? String(r[0].slug || '') : '';
  const bySlug = {};
  for (const a of l) if (a && a.slug) bySlug[a.slug] = a;
  // 逐篇 hash 全等比较：改老文章正文时篇数和最新 slug 都不变，只有 hash 会变
  let changed = 0;
  for (const a of r) {
    const b = bySlug[a && a.slug];
    if (b && a.hash && b.hash && a.hash !== b.hash) changed += 1;
  }
  const added = Math.max(0, remoteCount - localCount);
  let status = 'same';
  if (added > 0 || (remoteCount === localCount && newestRemote && newestRemote !== newestLocal)) status = 'stale';
  if (changed > 0) status = 'updated'; // updated 是 superset：也可能同时有新增
  return { status, localCount, remoteCount, newestLocal, newestRemote, added, changed };
}

/** 顶层 commit（builder / 内容仓库产出，字段名容错）。 */
export function commitOf(meta) {
  const m = meta || {};
  return String(m.commit || m.commit_sha || m.rev || m.sha || '');
}

/**
 * commit 锁定基址：jsDelivr 对 @main 有缓存，md/图片必须走 @<commit> 才必然新鲜。
 * 拿不到 commit 时回落原基址。
 */
export function pinned(base, commit) {
  const b = String(base || '').replace(/\/+$/, '');
  const c = String(commit || '');
  if (!c || !/jsdelivr/i.test(b)) return b; // gh raw 是实时源，不需要也不能 pin
  if (/@[^/]+$/.test(b)) return b.replace(/@[^/]+$/, '@' + c);
  return b;
}

/** gh raw 有 CDN 缓存（max-age 约 5 分钟），实时必须打时间戳；CDN 源不打，保住缓存。 */
export function freshUrl(url, base) {
  if (!isRaw(base)) return url;
  return url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
}

/* ───────────────────────── 同步 ───────────────────────── */

/** 单源拉清单：cache:'no-cache' 走 ETag 重验证，保留 CDN 缓存收益。 */
async function fetchMetaOnce(base, timeout, bust) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeout);
  try {
    const url = freshUrl(base + '/meta.json', base) + (bust ? '&r=' + Date.now() : '');
    const res = await fetch(url, {
      cache: 'no-cache',
      credentials: 'omit',
      mode: 'cors',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const remote = await res.json();
    const articles = sortByDate(Array.isArray(remote.articles) ? remote.articles : []);
    if (!articles.length) throw new Error('远端清单为空');
    return { remote, articles };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 双源同步：首选 → 兜底 → offline。两段各自 timeout（默认 2s）。
 * 全部失败只记一条 console.info，绝不阻塞启动、绝不刷屏。
 */
export async function sync({ doc = document, meta = null, timeout = 2000, base = null, bust = false } = {}) {
  const t0 = now();
  const { primary, fallback } = contentBases(doc);
  const queue = [];
  if (base) queue.push(trimBase(base));
  else {
    if (state.base) queue.push(state.base);   // 上次成功的源优先
    queue.push(primary);
    if (fallback) queue.push(fallback);
  }
  const tried = [];
  let used = '';
  let lastErr = null;
  let payload = null;

  for (const b of queue) {
    if (!b || tried.indexOf(b) >= 0) continue;
    tried.push(b);
    try {
      payload = await fetchMetaOnce(b, timeout, bust);
      used = b;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  const local = meta && Array.isArray(meta.articles) ? meta.articles : [];
  if (payload) {
    const cmp = compareMeta(sortByDate(local), payload.articles);
    const commit = commitOf(payload.remote);
    state = {
      status: cmp.status,
      localCount: local.length,
      remoteCount: payload.articles.length,
      articles: payload.articles,
      fetchedAt: Date.now(),
      base: used,
      assetBase: pinned(used, commit),
      commit,
      tried,
      error: null,
      ms: now() - t0,
      added: cmp.added,
      changed: cmp.changed,
      meta: payload.remote,
    };
    offlineLogged = false;
  } else {
    state = {
      status: 'offline',
      localCount: local.length,
      remoteCount: 0,
      articles: [],
      fetchedAt: Date.now(),
      base: state.base || primary,
      tried,
      error: (lastErr && lastErr.message) || String(lastErr),
      ms: now() - t0,
      added: 0,
      meta: null,
    };
    if (!offlineLogged && typeof console !== 'undefined') {
      offlineLogged = true;
      console.info('[remote] 远端不可达，使用构建期清单（' + (state.error || 'offline') + '）');
    }
  }
  return state;
}

/* ───────────────────────── 视图 ───────────────────────── */

/** boot 的 views 阶段调用：列表热更新 + 404 新文章直达。返回挂载的视图数。 */
export function mount({ doc = document, store = null, platform = null, meta = null, remoteState = null } = {}) {
  if (mounted) return 0;
  mounted = true;
  const st = remoteState || state;
  let views = 0;

  try {
    views += mountLists({ doc, st, meta, store });
  } catch (err) { if (typeof console !== 'undefined') console.error('[remote] list', err); }

  try {
    const slug = pendingSlug(doc, meta);
    if (slug) {
      views += 1;
      renderArticle({ doc, meta, slug, base: assetBase(st, doc), store });
    } else {
      const post = postSlug(doc);
      if (post) {
        views += 1;
        // 不 await：md 拉取不占任何启动检查点
        mountPost({ doc, meta, st, slug: post, store });
      }
    }
  } catch (err) { if (typeof console !== 'undefined') console.error('[remote] article', err); }

  return views;
}

/** 404 页 + /posts/<slug>/ + slug 不在本地清单 → 需要运行时拉取。 */
export function pendingSlug(doc = document, meta = null) {
  try {
    if (doc.documentElement.getAttribute('data-page') !== '404') return null;
    const m = /^\/posts\/([^/]+)\/$/.exec((doc.defaultView || {}).location ? doc.defaultView.location.pathname : '');
    if (!m) return null;
    const slug = decodeURIComponent(m[1]);
    const local = (meta && Array.isArray(meta.articles)) ? meta.articles : [];
    if (local.some((a) => a && a.slug === slug)) return null;
    return slug;
  } catch { return null; }
}

/** 内容基址：优先 commit 锁定地址（jsDelivr @main 有缓存，不可信）。 */
function assetBase(st, doc) {
  return (st && (st.assetBase || st.base)) || contentBase(doc);
}

/** 文章页 slug：data-page="post" 且 /posts/<slug>/。 */
export function postSlug(doc = document) {
  try {
    if (doc.documentElement.getAttribute('data-page') !== 'post') return null;
    const loc = (doc.defaultView || {}).location;
    const m = /^\/posts\/([^/]+)\/$/.exec(loc ? loc.pathname : '');
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

async function fetchText(url, timeout, base) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeout || 8000);
  try {
    const res = await fetch(freshUrl(url, base), { cache: 'no-cache', credentials: 'omit', mode: 'cors', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(timer); }
}

const slugify = (s) => String(s).trim().toLowerCase()
  .replace(/[^\w\u4e00-\u9fa5 -]/g, '')
  .replace(/\s+/g, '-')
  .replace(/^-+|-+$/g, '');

/** 锚点 id 规则：标题文本 slug 化，重复加 -1/-2。 */
function decorateHeadings(root) {
  const seen = {};
  const hs = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  for (const h of hs) {
    if (h.id) continue;
    const base = slugify(h.textContent) || 'section';
    seen[base] = (seen[base] || 0) + 1;
    h.id = seen[base] > 1 ? base + '-' + (seen[base] - 1) : base;
  }
  return hs.length;
}

/** 文章候选基址：gh raw（实时）→ @commit（不可变，必然新鲜）→ @main → 兜底。 */
export function articleBases(doc, st) {
  const { primary, fallback } = contentBases(doc);
  const all = [primary, fallback];
  const raw = all.filter(isRaw)[0] || '';
  const cdn = all.filter((u) => /jsdelivr/i.test(u))[0] || '';
  const list = [];
  const push = (u) => { const v = trimBase(u); if (v && list.indexOf(v) < 0) list.push(v); };
  push(raw);
  if (cdn) { if (st && st.commit) push(pinned(cdn, st.commit)); push(cdn); }
  push(primary);
  push(fallback);
  return list;
}

/** 拉一篇文章的 md：按候选基址逐个试，返回 { data, node, base }。 */
async function buildArticle(doc, bases, slug) {
  let lastErr = null;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      const md = await fetchText(base + '/posts/' + encodeURIComponent(slug) + '/index.md', i === 0 ? 4000 : 2500, base);
      const { data, body } = parseFrontMatter(md);
      const { marked } = await import('marked');
      const node = doc.createElement('div');
      node.className = 'post-content remote-article';
      node.innerHTML = marked.parse(body, { gfm: true });
      decorateHeadings(node);
      rewriteAssets(node, base, slug);
      await highlight(node);
      return { data, node, base };
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('md 拉取失败');
}

const POST_LOADING = '正在从内容仓库拉取…';

function loadingLine(doc, text) {
  const el = doc.createElement('div');
  el.className = 'remote-loading post-loading';
  el.setAttribute('aria-busy', 'true');
  el.textContent = text;
  return el;
}

function errorLine(doc, text) {
  const el = doc.createElement('div');
  el.className = 'remote-error';
  const s = doc.createElement('span');
  s.textContent = text;
  el.appendChild(s);
  return el;
}

function cutButton(doc, label, onClick) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'cut';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 文章页一加载就把静态正文换成加载态：打开即加载，绝不先闪旧正文。
 * 由模块求值末尾自动调用（manifest 阶段之前就生效）。
 */
export function preparePost(doc = document) {
  try {
    const art = doc.querySelector('.post-content');
    if (!art || art.__kbPrepared) return false;
    art.__kbPrepared = true;
    // 构建版正文在 <noscript> 里（JS 开启时不可见但 DOM 里在），失败时用它兜底
    art.__kbFallback = noscriptHtml(art) || '';
    // builder 模板已内置 .post-loading；缺失时补一行，文案统一
    if (!art.querySelector('.post-loading')) {
      art.insertBefore(loadingLine(doc, POST_LOADING), art.firstChild);
    }
    return true;
  } catch { return false; }
}

function noscriptHtml(scope) {
  try {
    const ns = scope && scope.querySelector ? scope.querySelector('noscript') : null;
    return ns ? String(ns.textContent || '') : '';
  } catch { return ''; }
}

/** 文章页：拉 md → 渲染 → 替换加载态；失败给错误态 + 重试 + 构建版兜底。无刷新、无 note。 */
async function mountPost({ doc, meta, st, slug, store }) {
  const art = doc.querySelector('.post-content');
  if (!art) return false;
  if (!art.__kbPrepared) preparePost(doc);
  const fallback = art.__kbFallback || '';
  try {
    const { data, node, base } = await buildArticle(doc, articleBases(doc, st), slug);
    while (art.firstChild) art.removeChild(art.firstChild);
    while (node.firstChild) art.appendChild(node.firstChild);
    updatePostHeader(doc, data);
    updateHead(doc, data, slug, meta);
    if (store) store.setData({ remoteArticle: { slug, title: data.title || slug, base, at: Date.now() } });
    return true;
  } catch (err) {
    // 断网/404/双源全挂：错误行 + noscript 里的构建版正文（不是无限「正在拉取…」）
    art.textContent = '';
    const box = errorLine(doc, '内容仓库暂时不可达 · 显示构建版本');
    box.appendChild(cutButton(doc, '重试', () => {
      art.textContent = '';
      art.appendChild(loadingLine(doc, POST_LOADING));
      mountPost({ doc, meta, st: getRemoteState(), slug, store });
    }));
    art.appendChild(box);
    const raw = fallback || noscriptHtml(art);
    if (raw) {
      const wrap = doc.createElement('div');
      wrap.innerHTML = raw;
      while (wrap.firstChild) art.appendChild(wrap.firstChild);
    }
    return false;
  }
}

function updatePostHeader(doc, data) {
  const head = doc.querySelector('.post-header');
  if (!head) return;
  const h1 = head.querySelector('h1');
  if (h1 && data.title) h1.textContent = data.title;
  const date = head.querySelector('.news-date');
  if (date && data.date) date.textContent = dayPath(data.date);
  if (Array.isArray(data.tags)) {
    const box = Array.from(head.querySelectorAll('div')).find((d) => d.querySelector('span.tag'));
    if (box) {
      box.textContent = '';
      data.tags.forEach((t) => {
        const s = doc.createElement('span');
        s.className = 'tag';
        s.textContent = t;
        box.appendChild(s);
      });
    }
  }
}

/* 本次会话已渲染过的列表状态：用来判断「新增」和是否需要提示 */
const session = { rendered: false, slugs: [], lastSync: 0, watched: false };

function captureFallback(box) {
  if (!box.__kbFallback) box.__kbFallback = box.innerHTML;
  return box.__kbFallback;
}

/** 骨架：一行加载态（不依赖任何 CSS 也能读）。 */
function skeleton(doc, box) {
  box.textContent = '';
  box.appendChild(loadingLine(doc, POST_LOADING));
}

/** 拉不到 → noscript 里的静态列表 + 一行「离线 · 显示构建版本」；连兜底都没有才报错。 */
function showFallback(doc, box, meta) {
  const raw = noscriptHtml(box.parentNode) || noscriptHtml(doc) || captureFallback(box);
  box.textContent = '';
  if (raw && /news-item/.test(raw)) {
    const host = box.parentNode || box;
    const old = host.querySelector ? host.querySelector('.remote-note') : null;
    if (old && old.parentNode) old.parentNode.removeChild(old);
    host.insertBefore(makeNote(doc, '离线 · 显示构建版本', () => refresh(doc, meta, null)), host.firstChild);
    const wrap = doc.createElement('div');
    wrap.innerHTML = raw;
    while (wrap.firstChild) box.appendChild(wrap.firstChild);
    return;
  }
  const err = errorLine(doc, '加载失败');
  err.appendChild(cutButton(doc, '重试', () => {
    skeleton(doc, box);
    sync({ doc, meta, bust: true, timeout: 4000 }).then((st) => {
      if (st && st.status !== 'offline' && st.articles && st.articles.length) mountLists({ doc, st, meta, store: null, force: true });
      else showFallback(doc, box, meta);
    });
  }));
  box.appendChild(err);
}

function listItems(box, st) {
  const kind = box.getAttribute('data-remote-list') || 'posts';
  const tag = box.getAttribute('data-tag');
  let items = st.articles || [];
  if (kind === 'tag') {
    if (!tag) return [];
    items = items.filter((a) => (a.tags || []).some((t) => String(t).toLowerCase() === String(tag).toLowerCase()));
  } else if (kind === 'home') {
    // 条数由 builder 的 data-limit 决定（对应 latest_count），缺省 5
    items = items.slice(0, Number(box.getAttribute('data-limit')) || 5);
  }
  return items;
}

function renderList(doc, box, tpl, st) {
  const items = listItems(box, st);
  box.textContent = '';
  if (!items.length) { box.appendChild(loadingLine(doc, '暂无文章')); return 0; }
  const kind = box.getAttribute('data-remote-list') || 'posts';
  const frag = doc.createDocumentFragment();
  items.forEach((a) => frag.appendChild(buildItem(doc, tpl, a, kind)));
  box.appendChild(frag);
  return items.length;
}

/** 列表挂载：先骨架，再数据；数据失败走静态兜底。 */
function mountLists({ doc, st, meta, store, force = false }) {
  const boxes = Array.from(doc.querySelectorAll('[data-remote-list]'));
  if (!boxes.length) return 0;
  const tpl = doc.getElementById('postItemTpl');
  const has = !!(st && st.articles && st.articles.length);
  const offline = !st || st.status === 'offline';

  for (const box of boxes) {
    if (!box.__kbFallback) captureFallback(box);
    if (has && tpl) renderList(doc, box, tpl, st);
    else if (offline) showFallback(doc, box, meta);
    else skeleton(doc, box);
  }

  if (has && tpl) {
    session.rendered = true;
    session.slugs = (st.articles || []).map((a) => a.slug);
    session.lastSync = Date.now();
    watch(doc, meta);
    if (store && !force) store.setData({ remote: st, remoteList: { count: session.slugs.length, at: Date.now() } });
  }
  return boxes.length;
}

/** 页面重新可见时（≥60s）复查一次：有新增才提示。 */
function watch(doc, meta) {
  if (session.watched) return;
  session.watched = true;
  doc.addEventListener('visibilitychange', () => {
    try {
      if (doc.visibilityState !== 'visible' || !session.rendered) return;
      if (Date.now() - session.lastSync < 60000) return;
      refresh(doc, meta, null);
    } catch { /* 忽略 */ }
  });
}

/** 按 builder 的 #postItemTpl 结构填充；模板缺字段时跳过，不抛异常。 */
function buildItem(doc, tpl, a, kind) {
  let node = null;
  try {
    const frag = tpl.content ? tpl.content.cloneNode(true) : null;
    node = frag && frag.firstElementChild ? frag.firstElementChild : null;
  } catch { node = null; }
  if (!node) {
    node = doc.createElement('a');
    node.className = 'news-item';
  }
  const q = (sel) => (node.querySelector ? node.querySelector(sel) : null);
  const url = a.url || ('/posts/' + (a.slug || '') + '/');
  const title = a.title || a.slug || '';
  node.setAttribute('href', url);
  node.setAttribute('data-c', 'post');
  if (node.classList) node.classList.add('rv', 'vis');
  // 读屏不能只念「文章条目」：有 aria-label 就用标题覆盖，没有就不动
  if (node.hasAttribute && node.hasAttribute('aria-label')) node.setAttribute('aria-label', title);

  const tagEl = q('.news-tag');
  if (tagEl) tagEl.textContent = kind === 'home' ? '文章' : monthPath(a.date);
  const titleEl = q('.news-title');
  if (titleEl) titleEl.textContent = title;
  const sumEl = q('.news-summary');
  if (sumEl) sumEl.textContent = a.summary || '';
  const dateEl = q('.news-date');
  if (dateEl) dateEl.textContent = kind === 'home' ? dayPath(a.date) : (a.categories || []).join('');
  const readEl = q('.news-reading');
  if (readEl && a.reading_minutes) readEl.textContent = a.reading_minutes + ' 分钟';
  return node;
}

function makeNote(doc, text, onClick) {
  const note = doc.createElement('p');
  note.className = 'remote-note';
  const label = doc.createElement('span');
  label.textContent = text;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'cut';
  btn.textContent = '刷新';
  btn.addEventListener('click', onClick);
  note.appendChild(label);
  note.appendChild(btn);
  return note;
}

/** 只有「已渲染过 + 又拉到更多」才提示，首次加载不提示。 */
function insertNote(doc, box, n, meta) {
  const host = box.parentNode || box;
  const old = host.querySelector('.remote-note');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  const note = makeNote(doc, n + ' 篇新增 · 来自内容仓库', () => refresh(doc, meta, null));
  if (host.insertBefore) host.insertBefore(note, host.firstChild);
  else host.appendChild(note);
}

/** 刷新 = 重拉 meta → 与已渲染列表 diff → 新的插到顶部并高亮。 */
async function refresh(doc, meta, btn) {
  if (refreshing) return;
  refreshing = true;
  if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
  try {
    const st = await sync({ doc, meta, bust: true, timeout: 4000 });
    session.lastSync = Date.now();
    const tpl = doc.getElementById('postItemTpl');
    if (!tpl || !st || st.status === 'offline' || !st.articles || !st.articles.length) return;
    const known = session.slugs || [];
    const fresh = st.articles.filter((a) => known.indexOf(a.slug) < 0);
    const boxes = Array.from(doc.querySelectorAll('[data-remote-list]'));
    for (const box of boxes) renderList(doc, box, tpl, st);
    if (fresh.length) {
      for (const box of boxes) {
        Array.from(box.querySelectorAll('a.news-item')).slice(0, fresh.length).forEach((el) => {
          if (el.classList) el.classList.add('fresh');
        });
        insertNote(doc, box, fresh.length, meta);
      }
      session.slugs = st.articles.map((a) => a.slug);
    }
    if (btn) { btn.disabled = false; btn.textContent = fresh.length ? '刷新' : '已是最新'; }
  } finally {
    refreshing = false;
  }
}

/* ── 404：运行时渲染未构建的新文章 ── */

async function renderArticle({ doc, meta, slug, base, store }) {
  const box = doc.getElementById('remoteArticle');
  if (!box) return false;
  box.hidden = false;
  box.textContent = '';
  const loading = doc.createElement('p');
  loading.className = 'remote-loading';
  loading.textContent = '正在从内容仓库加载文章…';
  box.appendChild(loading);

  try {
    const built = await buildArticle(doc, articleBases(doc, state), slug);
    const { data, node } = built;
    if (data.draft === true) throw new Error('草稿未发布');

    box.textContent = '';
    box.appendChild(heading(doc, data, slug));
    box.appendChild(node);
    const hl = node.querySelectorAll('pre.chroma').length;
    updateHead(doc, data, slug, meta);
    await ensureMainCss(doc);
    if (store) store.setData({ remoteArticle: { slug, title: data.title || slug, highlighted: hl, at: Date.now() } });
    try { doc.documentElement.classList.add('remote-post'); } catch { /* 忽略 */ }
    return true;
  } catch (err) {
    showRetry(doc, box, err, () => renderArticle({ doc, meta, slug, base, store }));
    return false;
  }
}

function heading(doc, data, slug) {
  const wrap = doc.createElement('div');
  wrap.className = 'remote-head';
  const h1 = doc.createElement('h1');
  h1.className = 'remote-title';
  h1.textContent = data.title || slug;
  const metaEl = doc.createElement('p');
  metaEl.className = 'remote-meta';
  const bits = [];
  if (data.date) bits.push(dayPath(data.date));
  if (Array.isArray(data.tags) && data.tags.length) bits.push(data.tags.join(' · '));
  metaEl.textContent = bits.join(' · ');
  wrap.appendChild(h1);
  if (metaEl.textContent) wrap.appendChild(metaEl);
  return wrap;
}

function showRetry(doc, box, err, retry) {
  box.hidden = false;
  box.textContent = '';
  const p = doc.createElement('p');
  p.className = 'remote-error';
  p.textContent = '该文章可能尚未构建，稍后再试';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'cut';
  btn.textContent = '重试';
  btn.addEventListener('click', () => { btn.disabled = true; retry(); });
  box.appendChild(p);
  box.appendChild(btn);
  if (typeof console !== 'undefined') console.warn('[remote] article failed', err && err.message ? err.message : err);
}

/** 正文相对资源 → 内容仓库绝对地址；站内绝对路径 / 锚点 / data: 不动。 */
function rewriteAssets(root, base, slug) {
  const prefix = base.replace(/\/+$/, '') + '/posts/' + encodeURIComponent(slug) + '/';
  const fix = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(s)) return null;
    return prefix + s.replace(/^\.\//, '');
  };
  Array.from(root.querySelectorAll('img[src],video[src],audio[src],source[src]')).forEach((el) => {
    const next = fix(el.getAttribute('src'));
    if (next) el.setAttribute('src', next);
  });
  Array.from(root.querySelectorAll('a[href]')).forEach((el) => {
    const next = fix(el.getAttribute('href'));
    if (next) el.setAttribute('href', next);
  });
  Array.from(root.querySelectorAll('img[srcset]')).forEach((el) => {
    const next = String(el.getAttribute('srcset')).split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      const fixed = fix(bits[0]);
      return fixed ? [fixed, bits[1]].filter(Boolean).join(' ') : part.trim();
    }).join(', ');
    el.setAttribute('srcset', next);
  });
}

/** hljs → 现有 .chroma 短类名，复用站点已有代码高亮配色。 */
const CHROMA = {
  keyword: 'k', built_in: 'nb', type: 'kt', literal: 'l', number: 'm', string: 's', comment: 'c',
  title: 'nf', section: 'nf', attr: 'na', attribute: 'na', tag: 'nt', name: 'nt', variable: 'nv',
  'template-variable': 'nv', operator: 'o', punctuation: 'p', meta: 'c1', params: 'n', property: 'py',
  regexp: 'sx', symbol: 'l', bullet: 'c1', code: 'c1', emphasis: 'sx', strong: 'k', quote: 'c1',
  link: 'sx', formula: 'k', deletion: 'err', addition: 'gi', subst: 'n',
};
export function toChroma(html) {
  return String(html).replace(/hljs-([a-z_]+)/g, (m, name) => CHROMA[name] || 'n');
}

// 站点实际只用 bash / ini / cpp（21 篇统计），text 直接转义，不注册语言。
// 只 import core + 三个语言，避免整包 highlight.js（gzip 54 KB）。
let hljsPromise = null;
function loadHljs() {
  if (!hljsPromise) {
    hljsPromise = (async () => {
      const [core, bash, ini, cpp] = await Promise.all([
        import('highlight.js/lib/core'),
        import('highlight.js/lib/languages/bash'),
        import('highlight.js/lib/languages/ini'),
        import('highlight.js/lib/languages/cpp'),
      ]);
      const hljs = core.default;
      hljs.registerLanguage('bash', bash.default);
      hljs.registerLanguage('ini', ini.default);
      hljs.registerLanguage('cpp', cpp.default);
      return hljs;
    })();
  }
  return hljsPromise;
}

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

async function highlight(root) {
  const blocks = Array.from(root.querySelectorAll('pre > code'));
  if (!blocks.length) return 0;
  let hljs = null;
  try { hljs = await loadHljs(); } catch { return 0; }
  let n = 0;
  for (const code of blocks) {
    try {
      const m = /language-([\w+#-]+)/.exec(code.className || '');
      const lang = m && m[1];
      const known = lang && hljs.getLanguage(lang);
      const out = known
        ? hljs.highlight(code.textContent, { language: lang }).value
        : lang === 'text' || lang === 'plaintext' || lang === 'plain'
          ? escapeHtml(code.textContent)
          : hljs.highlight(code.textContent, { language: 'bash' }).value;
      code.innerHTML = toChroma(out);
      if (code.classList) code.classList.add('hljs');
      const pre = code.parentNode;
      if (pre && pre.tagName === 'PRE' && pre.classList) pre.classList.add('chroma');
      n += 1;
    } catch { /* 单块失败不影响整篇 */ }
  }
  return n;
}

function updateHead(doc, data, slug, meta) {
  const site = (meta && meta.site) || {};
  const siteTitle = site.title || 'K-BLACK';
  doc.title = (data.title ? data.title + ' · ' : '') + siteTitle;
  const desc = data.summary || '';
  setMetaTag(doc, 'name', 'description', desc);
  setMetaTag(doc, 'property', 'og:title', data.title || slug);
  setMetaTag(doc, 'property', 'og:description', desc);
  const origin = site.base ? String(site.base).replace(/\/+$/, '') : (doc.defaultView && doc.defaultView.location ? doc.defaultView.location.origin : '');
  const href = origin + '/posts/' + slug + '/';
  let link = doc.querySelector('link[rel="canonical"]');
  if (!link) {
    link = doc.createElement('link');
    link.setAttribute('rel', 'canonical');
    doc.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function setMetaTag(doc, attr, name, value) {
  if (!value) return;
  let el = doc.querySelector('meta[' + attr + '="' + name + '"]');
  if (!el) {
    el = doc.createElement('meta');
    el.setAttribute(attr, name);
    doc.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

/** 404 外壳只带 error.css；注入正文样式（/css/manifest.json 由 stylist 产出）。 */
async function ensureMainCss(doc) {
  try {
    if (doc.querySelector('link[href*="/css/main."]')) return true;
    const res = await fetch('/css/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const mf = await res.json();
    const href = mf.file || (mf.hash ? '/css/main.' + mf.hash + '.css' : '');
    if (!href) return false;
    const link = doc.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', href);
    doc.head.appendChild(link);
    return true;
  } catch { return false; }
}

const api = {
  sync, mount, getRemoteState, contentBase, contentBases, compareMeta, commitOf, pinned, freshUrl,
  parseFrontMatter, parseYamlLite, pendingSlug, postSlug, articleBases, preparePost, toChroma, monthPath, dayPath,
  refreshList: () => refresh(document, null, null),
};

// 调试出口：window.__kb.remote（main.js 先建好 window.__kb）
try {
  if (typeof window !== 'undefined') {
    window.__kb = window.__kb || {};
    window.__kb.remote = api;
  }
} catch { /* 忽略 */ }

// 文章页：模块一求值就把静态正文换成加载态（打开即加载，不闪旧正文）
try { preparePost(); } catch { /* 忽略 */ }

export default api;
