/**
 * remote.js —— 运行时远端同步层（独立动态 chunk，只在 boot 的 manifest 阶段被 import）。
 *
 * 三条底线：
 *  1. 远端失败/超时（2s）一律静默降级为 offline，绝不阻塞启动与正文；
 *  2. 列表只增不减：远端比本地少时不动，避免构建期刚发版被旧缓存覆盖；
 *  3. markdown / hljs 只在「404 页命中未构建的新文章」时才 import，不进入口包。
 */

// 国内网络：raw.githubusercontent.com 常被重置，jsDelivr 优先，raw 兜底。
const DEFAULT_PRIMARY = 'https://cdn.jsdelivr.net/gh/K-Blaaaack/articles@main';
const DEFAULT_FALLBACK = 'https://raw.githubusercontent.com/K-Blaaaack/articles/main';
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

/** 双源：data-content-base（首选）+ data-content-fallback（兜底），缺省 jsDelivr → raw。 */
export function contentBases(doc = document) {
  let primary = '';
  let fallback = '';
  try {
    const el = doc && doc.documentElement;
    if (el) {
      primary = trimBase(el.getAttribute('data-content-base'));
      fallback = trimBase(el.getAttribute('data-content-fallback'));
    }
  } catch { /* 忽略 */ }
  if (!primary) primary = DEFAULT_PRIMARY;
  if (!fallback) fallback = /jsdelivr/i.test(primary) ? DEFAULT_FALLBACK : DEFAULT_PRIMARY;
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
  let status = 'same';
  if (remoteCount > localCount) status = 'stale';
  else if (remoteCount === localCount && newestRemote && newestRemote !== newestLocal) status = 'stale';
  return { status, localCount, remoteCount, newestLocal, newestRemote, added: Math.max(0, remoteCount - localCount) };
}

/* ───────────────────────── 同步 ───────────────────────── */

/** 单源拉清单：cache:'no-cache' 走 ETag 重验证，保留 CDN 缓存收益。 */
async function fetchMetaOnce(base, timeout, bust) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeout);
  try {
    const url = base + '/meta.json' + (bust ? '?t=' + Date.now() : '');
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
    state = {
      status: cmp.status,
      localCount: local.length,
      remoteCount: payload.articles.length,
      articles: payload.articles,
      fetchedAt: Date.now(),
      base: used,
      tried,
      error: null,
      ms: now() - t0,
      added: cmp.added,
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
    const n = applyLists(doc, st, meta, store);
    if (n) views += n;
  } catch (err) { if (typeof console !== 'undefined') console.error('[remote] list', err); }

  try {
    const slug = pendingSlug(doc, meta);
    if (slug) {
      views += 1;
      renderArticle({ doc, meta, slug, base: st.base || contentBase(doc), store });
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

function applyLists(doc, st, meta, store) {
  if (!st || st.status !== 'stale') return 0;
  const tpl = doc.getElementById('postItemTpl');
  if (!tpl) return 0;
  const boxes = Array.from(doc.querySelectorAll('[data-remote-list]'));
  let n = 0;
  for (const box of boxes) {
    const kind = box.getAttribute('data-remote-list') || 'posts';
    const tag = box.getAttribute('data-tag');
    let items = st.articles;
    if (kind === 'tag') {
      if (!tag) continue;
      items = items.filter((a) => (a.tags || []).some((t) => String(t).toLowerCase() === String(tag).toLowerCase()));
      if (!items.length) continue; // 远端没有这个标签 → 不动静态页
    } else if (kind === 'home') {
      // 条数由 builder 的 data-limit 决定（对应 latest_count），缺省 5
      const limit = Number(box.getAttribute('data-limit')) || 5;
      items = items.slice(0, limit);
    }
    if (!items.length) continue;
    renderBox(doc, box, tpl, items, kind, st);
    n += 1;
  }
  if (n && store) store.setData({ remote: st, remoteList: { updated: n, at: Date.now() } });
  return n;
}

function isPostItem(el) {
  if (!el || el.tagName !== 'A') return false;
  if (el.getAttribute('data-c') === 'post') return true;
  return /^\/posts\//.test(el.getAttribute('href') || '');
}
function renderBox(doc, box, tpl, items, kind, st) {
  const kids = Array.from(box.children);
  const keep = kids.filter((el) => !isPostItem(el));
  const anchor = keep[0] || null;
  kids.filter(isPostItem).forEach((el) => box.removeChild(el));

  const frag = doc.createDocumentFragment();
  items.forEach((a) => frag.appendChild(buildItem(doc, tpl, a, kind)));
  if (anchor) box.insertBefore(frag, anchor); else box.appendChild(frag);
  insertNote(doc, box, st);
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

function insertNote(doc, box, st) {
  const old = box.querySelector ? box.querySelector('.remote-note') : null;
  if (old && old.parentNode) old.parentNode.removeChild(old);
  const note = doc.createElement('p');
  note.className = 'remote-note';
  const label = doc.createElement('span');
  const added = Math.max(0, (st.remoteCount || 0) - (st.localCount || 0));
  label.textContent = added > 0 ? '已同步 ' + added + ' 篇更新 · 来自内容仓库' : '远端清单有更新 · 来自内容仓库';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'cut';
  btn.textContent = '刷新';
  btn.addEventListener('click', () => refresh(doc, null, btn));
  note.appendChild(label);
  note.appendChild(btn);
  if (box.insertBefore) box.insertBefore(note, box.firstChild); else box.appendChild(note);
}

async function refresh(doc, meta, btn) {
  if (refreshing) return;
  refreshing = true;
  if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
  try {
    const st = await sync({ doc, meta, bust: true, timeout: 4000 });
    if (st.status === 'stale') {
      applyLists(doc, st, meta, null);
    } else {
      const notes = doc.querySelectorAll('.remote-note');
      Array.from(notes).forEach((n) => n.parentNode && n.parentNode.removeChild(n));
    }
    if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
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
    const url = base.replace(/\/+$/, '') + '/posts/' + encodeURIComponent(slug) + '/index.md';
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 8000);
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache', credentials: 'omit', mode: 'cors', signal: ctrl ? ctrl.signal : undefined });
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const { data, body } = parseFrontMatter(text);
    if (data.draft === true) throw new Error('草稿未发布');

    const { marked } = await import('marked');
    const html = marked.parse(body, { gfm: true });
    const art = doc.createElement('article');
    art.className = 'post-content remote-article';
    art.innerHTML = html;
    rewriteAssets(art, base, slug);

    box.textContent = '';
    box.appendChild(heading(doc, data, slug));
    box.appendChild(art);

    const hl = await highlight(art);
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
  sync, mount, getRemoteState, contentBase, contentBases, compareMeta, parseFrontMatter,
  parseYamlLite, pendingSlug, toChroma, monthPath, dayPath,
};

// 调试出口：window.__kb.remote（main.js 先建好 window.__kb）
try {
  if (typeof window !== 'undefined') {
    window.__kb = window.__kb || {};
    window.__kb.remote = api;
  }
} catch { /* 忽略 */ }

export default api;
