/**
 * overlay.js —— 搜索覆盖层 + 文章目录 + 页面增强。
 * 动态 import 的独立分包：主入口不含本文件，boot 的 core 阶段才会真正请求它。
 *
 * 依赖注入：store / platform 由 boot 传入，本文件不 import store，
 * 因此 esbuild 不需要 shared chunk —— 加载链只有 main.<hash>.js → chunk-<hash>.js。
 */

/* ───────────────────────── 纯函数：打分与排序（可单测） ───────────────────────── */

const FIELD = { title: 10, tag: 5, summary: 3, body: 1 };

export function scoreDoc(doc, query) {
  if (!doc || !query) return 0;
  const q = String(query).trim().toLowerCase();
  if (!q) return 0;
  const title = String(doc.t || doc.title || '').toLowerCase();
  const tags = doc.g || doc.tags || [];
  const summary = String(doc.s || doc.summary || '').toLowerCase();
  const body = String(doc.b || doc.body || '').toLowerCase();

  let score = 0;
  if (title.includes(q)) score += FIELD.title;
  for (const tag of tags) {
    if (String(tag).toLowerCase().includes(q)) { score += FIELD.tag; break; }
  }
  if (summary.includes(q)) score += FIELD.summary;
  if (body.includes(q)) score += FIELD.body;

  // 多词查询：整串没命中时，按单词取最高分，避免「整句不匹配就 0 结果」
  if (!score && /\s/.test(q)) {
    for (const term of q.split(/\s+/)) if (term) score = Math.max(score, scoreDoc(doc, term));
  }
  return score;
}

export function rankDocs(docs, query, limit = 12) {
  if (!Array.isArray(docs) || !query) return [];
  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(b.doc.d || '').localeCompare(String(a.doc.d || '')))
    .slice(0, limit)
    .map((x) => ({ u: x.doc.u || '/', t: x.doc.t || '', s: x.doc.s || '', kind: 'doc', score: x.score }));
}

export function rankEntities(list, query, kind, limit = 6) {
  if (!Array.isArray(list) || !query) return [];
  const q = String(query).trim().toLowerCase();
  return list
    .filter((e) => String(e.name || e.title || '').toLowerCase().includes(q) || String(e.slug || '').toLowerCase().includes(q))
    .slice(0, limit)
    .map((e) => ({ u: e.url || '/', t: e.name || e.title || '', s: kind === 'tag' ? (e.count || 0) + ' 篇' : '', kind, score: FIELD.title }));
}

export function normalizeDocs(index, meta) {
  if (index && Array.isArray(index.docs) && index.docs.length) {
    return index.docs.map((d) => ({ u: d.u || '/', t: d.t || '', g: d.g || [], s: d.s || '', b: d.b || '', d: d.d || '' }));
  }
  if (meta && Array.isArray(meta.articles)) {
    // 索引缺失时降级为清单过滤（契约 §5.2「索引失败 → 清单本地过滤」）
    return meta.articles.map((a) => ({ u: a.url || '/', t: a.title || '', g: a.tags || [], s: a.summary || '', b: '', d: a.date || '' }));
  }
  return [];
}

/* ───────────────────────────── DOM 视图 ───────────────────────────── */

const KIND_LABEL = { doc: '文章', tag: '标签', page: '页面' };
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

let mounted = false;

export function init({ store, platform, meta, index, remote = null, remoteState = null, doc = document, win = window } = {}) {
  if (mounted) return 3;
  mounted = true;
  const state = store.state;
  const docs = normalizeDocs(index || state.data.index, meta || state.data.meta);
  const source = index && index.docs && index.docs.length ? 'index' : docs.length ? 'manifest' : 'none';
  store.setSearch({ source });

  const views = [];
  try { views.push(createSearch({ store, platform, docs, meta: meta || state.data.meta, doc, win })); } catch (e) { console.error('[overlay] search', e); }
  try { views.push(createToc({ platform, doc, win })); } catch (e) { console.error('[overlay] toc', e); }
  try { initPage({ doc, win, platform }); views.push('page'); } catch (e) { console.error('[overlay] page', e); }
  try {
    // 远端同步层（独立 chunk）：列表热更新 + 404 新文章直达
    if (remote && typeof remote.mount === 'function') {
      const n = remote.mount({ doc, win, store, platform, meta: meta || state.data.meta, remoteState });
      views.push('remote:' + n);
    }
  } catch (e) { console.error('[overlay] remote', e); }

  return views.length;
}

/* ── 搜索覆盖层 ── */
function createSearch({ store, platform, docs, meta, doc, win }) {
  const state = store.state;
  const tags = (meta && meta.tags) || (state.data.meta && state.data.meta.tags) || [];
  const pages = (meta && meta.pages) || (state.data.meta && state.data.meta.pages) || [];

  let root = null;
  let input = null;
  let list = null;
  let status = null;
  let closeBtn = null;
  let results = [];
  let active = 0;
  let lastFocus = null;
  let built = false;

  function build() {
    if (built) return;
    built = true;
    root = doc.createElement('div');
    root.className = 'ovl ovl-search';
    root.id = 'ovlSearch';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ovlSearchTitle');
    root.hidden = true;
    root.innerHTML = [
      '<div class="ovl-backdrop" data-close></div>',
      '<div class="ovl-panel" role="document">',
      '  <h2 class="ovl-title" id="ovlSearchTitle">搜索</h2>',
      '  <button type="button" class="ovl-close" aria-label="关闭搜索">Esc</button>',
      '  <input class="ovl-input" type="search" role="combobox" aria-expanded="true" aria-controls="ovlList" aria-autocomplete="list" aria-label="搜索文章、标签、页面" placeholder="输入关键词…" autocomplete="off" spellcheck="false">',
      '  <p class="ovl-status" role="status" aria-live="polite"></p>',
      '  <ul class="ovl-list" id="ovlList" role="listbox" aria-label="搜索结果"></ul>',
      '  <p class="ovl-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</p>',
      '</div>',
    ].join('');
    doc.body.appendChild(root);
    input = root.querySelector('.ovl-input');
    list = root.querySelector('.ovl-list');
    status = root.querySelector('.ovl-status');
    closeBtn = root.querySelector('.ovl-close');
    input.addEventListener('input', onInput);
    closeBtn.addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target.hasAttribute && e.target.hasAttribute('data-close')) close(); });
    list.addEventListener('click', (e) => {
      const li = e.target.closest && e.target.closest('.ovl-item');
      if (li) go(Number(li.dataset.i));
    });
    input.addEventListener('keydown', onKey);
  }

  function onInput() {
    const q = input.value;
    const docHits = rankDocs(docs, q, 8);
    const tagHits = rankEntities(tags, q, 'tag', 4);
    const pageHits = rankEntities(pages, q, 'page', 3);
    results = docHits.concat(tagHits, pageHits).sort((a, b) => b.score - a.score);
    active = 0;
    render(q);
    store.setSearch({ query: q, results, total: results.length, status: results.length ? 'ready' : q ? 'empty' : 'idle' });
  }

  function render(q) {
    if (!list) return;
    list.textContent = '';
    results.forEach((r, i) => {
      const li = doc.createElement('li');
      li.className = 'ovl-item';
      li.id = 'ovl-opt-' + i;
      li.dataset.i = String(i);
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === active ? 'true' : 'false');
      li.innerHTML = '<span class="ovl-kind">' + KIND_LABEL[r.kind] + '</span><span class="ovl-label"></span><span class="ovl-sub"></span>';
      li.querySelector('.ovl-label').textContent = r.t || r.u;
      li.querySelector('.ovl-sub').textContent = r.s || '';
      list.appendChild(li);
    });
    syncActive();
    if (status) {
      status.textContent = q ? (results.length ? results.length + ' 条结果' : '没有匹配结果') : '输入关键词开始搜索';
    }
  }

  function syncActive() {
    if (!list) return;
    const items = list.children;
    for (let i = 0; i < items.length; i++) items[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
    if (items[active] && input) {
      input.setAttribute('aria-activedescendant', items[active].id);
      if (items[active].scrollIntoView) items[active].scrollIntoView({ block: 'nearest' });
    } else if (input) {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function move(delta) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    syncActive();
    store.setSearch({ active });
  }

  function go(i) {
    const r = results[i];
    if (!r) return;
    close();
    win.location.assign(r.u);
  }

  function onKey(e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); active = 0; syncActive(); break;
      case 'End': e.preventDefault(); active = results.length - 1; syncActive(); break;
      case 'Enter': e.preventDefault(); go(active); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': trap(e); break;
      default: break;
    }
  }

  // 焦点陷阱：Tab 只在对话框内循环
  function trap(e) {
    const items = Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === input);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open() {
    build();
    if (store.state.search.open) return;
    lastFocus = doc.activeElement;
    root.hidden = false;
    root.removeAttribute('inert');
    doc.body.style.overflow = 'hidden';
    const wrap = doc.getElementById('mainWrap');
    if (wrap && 'inert' in wrap) wrap.inert = true;
    store.openOverlay('search');
    store.setSearch({ open: true, status: results.length ? 'ready' : 'idle' });
    doc.title = 'K-BLACK · 搜索';
    if (win.location.hash !== '#search') {
      try { win.history.replaceState(null, '', '#search'); } catch { /* 忽略 */ }
    }
    if (input) { input.focus(); input.select(); }
    onInput();
  }

  function close() {
    if (!built || root.hidden) return;
    root.hidden = true;
    root.setAttribute('inert', '');
    doc.body.style.overflow = '';
    const wrap = doc.getElementById('mainWrap');
    if (wrap && 'inert' in wrap) wrap.inert = false;
    store.closeOverlay('search');
    store.setSearch({ open: false, active: 0 });
    doc.title = 'K-BLACK';
    if (win.location.hash === '#search') {
      try { win.history.replaceState(null, '', win.location.pathname + win.location.search); } catch { /* 忽略 */ }
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // 全局快捷键：/ 唤起，Esc 关闭；输入框内不劫持
  doc.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
      return;
    }
    if (e.key === 'Escape' && built && !root.hidden && !(t && t.tagName === 'INPUT')) close();
  });

  if (win.location.hash === '#search') open();

  return { open, close, kind: 'search' };
}

/* ── 文章目录（滚动高亮） ── */
function createToc({ platform, doc, win }) {
  // 目录只属于文章页：首页的区块标题、/stack/ 的卡片标题都不是章节
  if ((doc.documentElement.dataset.page || '') !== 'post') return null;
  const scope = doc.querySelector('.post-content') || doc.getElementById('main') || doc.body;
  const headings = Array.from(scope.querySelectorAll('h2, h3')).filter((h) => (h.textContent || '').trim().length > 0);
  if (headings.length < 2) return null;

  const slug = (text) => 'h-' + text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 40);
  const items = headings.map((h, i) => {
    if (!h.id) h.id = slug(h.textContent) + (i ? '-' + i : '');
    return { id: h.id, text: (h.textContent || '').trim(), level: h.tagName === 'H3' ? 3 : 2, el: h };
  });

  const nav = doc.createElement('nav');
  nav.className = 'ovl ovl-toc';
  nav.id = 'ovlToc';
  nav.setAttribute('aria-labelledby', 'ovlTocTitle');
  const expanded = platform.platform !== 'mobile';
  nav.innerHTML = '<button type="button" class="ovl-toc-toggle" id="ovlTocTitle" aria-expanded="' + expanded + '" aria-controls="ovlTocList">目录</button>'
    + '<ol class="ovl-toc-list" id="ovlTocList"></ol>';
  const list = nav.querySelector('.ovl-toc-list');
  items.forEach((it) => {
    const li = doc.createElement('li');
    li.className = 'ovl-toc-item' + (it.level === 3 ? ' is-sub' : '');
    li.innerHTML = '<a class="ovl-toc-link" href="#' + it.id + '"></a>';
    li.querySelector('a').textContent = it.text;
    list.appendChild(li);
  });
  doc.body.appendChild(nav);
  list.hidden = !expanded;

  const toggle = nav.querySelector('.ovl-toc-toggle');
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(next));
    list.hidden = !next;
    store_toc(next);
  });
  function store_toc(open) { nav.dataset.open = open ? '1' : '0'; }

  nav.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.ovl-toc-link');
    if (!a) return;
    e.preventDefault();
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const target = doc.getElementById(id);
    if (!target) return;
    const smooth = !platform.reducedMotion;
    try { target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); }
    catch { target.scrollIntoView(); }
    try { win.history.replaceState(null, '', '#' + id); } catch { /* 忽略 */ }
    if (platform.platform === 'mobile') { toggle.setAttribute('aria-expanded', 'false'); list.hidden = true; }
  });

  let ticking = false;
  let currentId = '';
  function update() {
    ticking = false;
    let activeId = items[0] ? items[0].id : '';
    for (const it of items) {
      const top = it.el.getBoundingClientRect().top;
      if (top <= 120) activeId = it.id; else break;
    }
    if (activeId === currentId) return;
    currentId = activeId;
    nav.querySelectorAll('.ovl-toc-link').forEach((a) => {
      const on = a.getAttribute('href') === '#' + activeId;
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
  }
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    if (win.requestAnimationFrame) win.requestAnimationFrame(update); else setTimeout(update, 16);
  };
  win.addEventListener('scroll', onScroll, { passive: true });
  update();

  if (win.location.hash === '#toc') { toggle.setAttribute('aria-expanded', 'true'); list.hidden = false; }
  return { nav, update, kind: 'toc' };
}

/* ── 页面增强（原 9 个 IIFE 的等价物，全部在分包里，不占入口预算） ── */
function initPage({ doc, win, platform }) {
  const onHome = win.location.pathname === '/' || win.location.pathname === '';

  // 汉堡菜单
  const burger = doc.getElementById('burger');
  const mob = doc.getElementById('mob');
  if (burger && mob) {
    burger.addEventListener('click', () => {
      const open = burger.classList.toggle('open');
      mob.classList.toggle('open', open);
      doc.body.style.overflow = open ? 'hidden' : '';
    });
    mob.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
      burger.classList.remove('open');
      mob.classList.remove('open');
      doc.body.style.overflow = '';
    }));
  }

  // 首页 tabs
  const tabs = Array.from(doc.querySelectorAll('.tab'));
  const newsItems = Array.from(doc.querySelectorAll('.news-item'));
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('on'));
    t.classList.add('on');
    const c = t.dataset.t;
    newsItems.forEach((i) => i.classList.toggle('hide', c !== 'all' && i.dataset.c !== c));
  }));

  // 滚动显现（保留 3s 兜底动画，观察器失效也不会空白）
  const reveal = Array.from(doc.querySelectorAll('.sec-hd,.news-featured,.prof-card,.lnk,.about-card,.news-item,.stack-card'));
  if (reveal.length && 'IntersectionObserver' in win) {
    reveal.forEach((e) => e.classList.add('rv'));
    const io = new win.IntersectionObserver((es) => {
      es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('vis'); io.unobserve(en.target); } });
    }, { threshold: 0.1 });
    reveal.forEach((e) => io.observe(e));
  }

  // 代码复制
  doc.querySelectorAll('.post-content pre').forEach((pre) => {
    const wrap = doc.createElement('div');
    wrap.className = 'code-wrap';
    if (pre.parentNode) pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      const done = () => { btn.textContent = '已复制'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
      else done();
    });
    wrap.appendChild(btn);
  });

  // 首页日期
  const heroDate = doc.getElementById('heroDate');
  if (heroDate) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    heroDate.textContent = d.getFullYear() + ' // ' + p(d.getMonth() + 1) + ' / ' + p(d.getDate());
  }

  // 粒子（reduced-motion 不生成）
  const particles = doc.getElementById('particles');
  if (particles && !platform.reducedMotion) {
    for (let i = 0; i < 20; i++) {
      const p = doc.createElement('div');
      p.className = 'particle';
      p.style.left = (Math.random() * 100).toFixed(2) + '%';
      p.style.animationDuration = (8 + Math.random() * 12).toFixed(2) + 's';
      p.style.animationDelay = (-Math.random() * 20).toFixed(2) + 's';
      const size = (1 + Math.random() * 2).toFixed(1) + 'px';
      p.style.width = size;
      p.style.height = size;
      particles.appendChild(p);
    }
  }

  // 首页导航高亮 + 平滑锚点
  if (onHome) {
    const ids = ['news', 'profile', 'links', 'about'];
    const map = { news: '/', profile: '/#profile', links: '/#links', about: '/#about' };
    const links = Array.from(doc.querySelectorAll('.nav-links a'));
    const mobLinks = Array.from(doc.querySelectorAll('.mob a'));
    let ticking = false;
    const spy = () => {
      ticking = false;
      let cur = '';
      for (const id of ids) {
        const el = doc.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= 150 && r.bottom > 0) cur = id;
      }
      if (cur === 'about') {
        const ab = doc.getElementById('about');
        if (ab && ab.getBoundingClientRect().bottom < win.innerHeight * 0.6) cur = '';
      }
      if (cur === 'profile' && win.scrollY < 100) cur = 'news';
      links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === map[cur]));
      mobLinks.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === map[cur]));
    };
    win.addEventListener('scroll', () => { if (!ticking) { ticking = true; win.requestAnimationFrame(spy); } }, { passive: true });
    win.addEventListener('resize', spy);
    spy();

    doc.querySelectorAll('.nav-links a,.mob a').forEach((a) => a.addEventListener('click', (e) => {
      const href = a.getAttribute('href') || '';
      if (href === '/') { e.preventDefault(); win.scrollTo({ top: 0, behavior: platform.reducedMotion ? 'auto' : 'smooth' }); return; }
      if (href.indexOf('/#') === 0) {
        e.preventDefault();
        const t = doc.getElementById(href.slice(2));
        if (t) t.scrollIntoView({ behavior: platform.reducedMotion ? 'auto' : 'smooth' });
      }
    }));
  }
}

export default { init, scoreDoc, rankDocs, rankEntities, normalizeDocs };
