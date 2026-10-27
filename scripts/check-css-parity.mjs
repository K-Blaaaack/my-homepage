#!/usr/bin/env node
/**
 * K-BLACK V3 · CSS 视觉零回归校验（stylist 作用域）
 * ---------------------------------------------------------------------------
 * 比对两侧：旧 docs/architecture/metrics/v2-main.css  ↔  新 src/styles/*（按 @import 顺序拼接）
 * 以及：新 dist/css/main.<hash8>.css（minified 产物）
 *
 * 断言（任一失败 → exit 1）：
 *   1. 旧选择器 100% 存在于新产物（允许新增，新增必须在白名单内）
 *   2. 逐 (媒体查询, 选择器, 属性) 的最终值一致（var() 递归解析后比较）
 *   3. 同属性、同特异性选择器的层叠先后顺序一致（防止搬运改变覆盖关系）
 *   4. @keyframes 名称与帧内容一致
 *   5. :root 只出现一次，且只在 tokens.css
 *   6. 十六进制色值只在 tokens.css 出现
 *   7. dist 产物 gzip ≤ 9.9 KB
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_FILE = path.join(ROOT, 'docs/architecture/metrics/v2-main.css');
const SRC_DIR = path.join(ROOT, 'src/styles');
const ENTRY = path.join(SRC_DIR, 'main.css');
const DIST_DIR = path.join(ROOT, 'dist/css');
const BUDGET = 9.9 * 1024;

/**
 * 新增选择器登记表（契约 §4 白名单）。前缀匹配：以任一条开头才算登记过。
 * 新增任何选择器都必须先在这里登记，否则门禁报「越界」。
 * 2026-10-27 task-3 续：覆盖层实装，按 src/js/overlay.js 的真实类名登记 .ovl-*。
 */
const NEW_SELECTOR_ALLOW = [
  '.no-js .loader',          // 无 JS：隐藏启动遮罩（契约 §3.5）
  '.no-js .main-wrap',       // 无 JS：正文立即可见（契约 §3.5）
  '.loader-line.warn',       // 启动超时降级行（31 号文档 §7）
  '.loader-retry',           // 启动失败重试（含 :hover/:active/:focus-visible）
  '.news-summary',           // 运行时注入的摘要行（两行截断）
  '.remote-note',            // 运行时同步提示条（含内层 .cut 按钮配方）
  '.remote-loading',         // 404 远程文章：加载占位
  '.remote-head',            // 404 远程文章：头部容器
  '.remote-title',           // 404 远程文章：标题
  '.remote-meta',            // 404 远程文章：日期/标签行
  '.remote-error',           // 404 远程文章：失败态（含紧邻的 button.cut）
  // V3 移动端阅读修正（390/360 实机）：全部是「既有选择器 + 新增媒体上下文」，
  // 桌面声明值一个没动；.post-content 前缀同时覆盖下列 .post-content * 选择器。
  '.nav',                    // 移动端实底顶栏（去玻璃）
  '.post-content',           // overflow-wrap:anywhere
  '.post-content h1',        // 移动端标题降级 24px
  '.post-header h1',         // 文章页标题（模板内联 28px，移动端 !important 降级）
  '.post-content h2',        // 20px
  '.post-content h3',        // 17px
  '.post-content h4',        // 15px
  '.post-content p',         // 移动端正文节奏
  '.post-content ul',        // 列表缩进 22px
  '.post-content ol',
  '.post-content code',      // 行内代码 .86em / 1px 5px（移动端）
  '.post-content pre',       // 14px + 惯性滚动
  '.post-content pre code',  // 12.5px
  '.post-content table',     // 窄屏横滚
  '.ovl',                    // 覆盖层全部：.ovl / .ovl-search / .ovl-toc / .ovl-*
                             //   选中态用 .ovl-item[aria-selected="true"]、.ovl-toc-link[aria-current]，
                             //   不用 .on（.on 只归导航/tab，未改原规则）
];

const fail = [];
const warn = [];
const bad = (msg) => fail.push(msg);

/* ───────────────────────── 解析器 ───────────────────────── */

function stripComments(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') { j += 2; continue; }
        if (css[j] === q) { j++; break; }
        j++;
      }
      out += css.slice(i, j); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}

function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === q) { j++; break; }
        j++;
      }
      i = j - 1; continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('花括号不配对');
}

function splitTop(str, sep) {
  const out = []; let depth = 0, cur = '', i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'") {
      const q = ch; let j = i + 1;
      while (j < str.length) {
        if (str[j] === '\\') { j += 2; continue; }
        if (str[j] === q) { j++; break; }
        j++;
      }
      cur += str.slice(i, j); i = j; continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  out.push(cur);
  return out;
}

const normWs = (s) => s.replace(/\s+/g, ' ').trim();
const normSel = (s) => normWs(s.replace(/\s*([>+~])\s*/g, ' $1 ')).replace(/\s*,\s*/g, ',');
const normMedia = (s) => normWs(s).toLowerCase().replace(/\s*:\s*/g, ':').replace(/,\s*/g, ',');
const canonSel = (s) => s
  .replace(/\[([a-zA-Z-]+)="([^"]*)"\]/g, '[$1=$2]')   // minify 会去掉属性选择器的引号
  .replace(/\*::?before/g, ':before')
  .replace(/\*::?after/g, ':after')
  .replace(/::/g, ':')
  .replace(/:nth-child\(1\)/g, ':first-child');

function parseDecls(body) {
  const decls = [];
  for (const raw of splitTop(body, ';')) {
    const t = raw.trim();
    if (!t) continue;
    const idx = t.indexOf(':');
    if (idx < 0) continue;
    const prop = t.slice(0, idx).trim().toLowerCase();
    let value = t.slice(idx + 1).trim();
    let important = false;
    if (/!\s*important$/i.test(value)) { important = true; value = value.replace(/!\s*important$/i, '').trim(); }
    if (!prop) continue;
    decls.push({ prop, value, important });
  }
  return decls;
}

function parse(css) {
  const rules = [];              // 扁平声明：{media, sel, prop, value, important, order}
  const keyframes = new Map();
  const rootDecls = [];
  let order = 0;

  function walk(text, media) {
    let i = 0, buf = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '/' && text[i + 1] === '*') {
        const e = text.indexOf('*/', i + 2);
        i = e < 0 ? text.length : e + 2; continue;
      }
      if (ch === '"' || ch === "'") {
        const q = ch; let j = i + 1;
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === q) { j++; break; }
          j++;
        }
        buf += text.slice(i, j); i = j; continue;
      }
      if (ch === '{') {
        const prelude = buf.trim(); buf = '';
        const end = matchBrace(text, i);
        const body = text.slice(i + 1, end);
        if (prelude.startsWith('@')) {
          const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
          if (name === 'media' || name === 'supports') {
            const inner = prelude.slice(1 + name.length).trim();
            walk(body, media ? media + ' && ' + normMedia(inner) : normMedia(inner));
          } else if (name === 'keyframes' || name === '-webkit-keyframes') {
            const kname = prelude.replace(/^@(-webkit-)?keyframes\s+/i, '').trim();
            keyframes.set(kname, normWs(body).replace(/\s*([:;{},])\s*/g, '$1'));
          }
        } else {
          const sels = splitTop(prelude, ',').map(normSel).filter(Boolean);
          const decls = parseDecls(body);
          for (const d of decls) {
            for (const sel of sels) rules.push({ media, sel, ...d, order: order++ });
          }
          if (sels.length === 1 && sels[0] === ':root') rootDecls.push(...decls);
        }
        i = end + 1; continue;
      }
      if (ch === '}') { i++; continue; }
      buf += ch; i++;
    }
  }

  walk(stripComments(css), '');
  return { rules, keyframes, rootDecls };
}

/* ───────────────────────── var() 解析 ───────────────────────── */

function resolveVars(value, vars, depth = 0) {
  if (typeof value !== 'string') return '';
  if (depth > 12 || !value.includes('var(')) return value;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let depthP = 0, j = at + 3;
    for (; j < value.length; j++) {
      if (value[j] === '(') depthP++;
      else if (value[j] === ')') { depthP--; if (depthP === 0) break; }
    }
    const inner = value.slice(at + 4, j);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    let repl = vars.get(name);
    if (repl == null) repl = fallback;
    if (repl == null) repl = 'var(' + inner + ')';   // 无法解析（如继承自父元素的 --cut）保留原样，两侧同等对待
    out += resolveVars(repl, vars, depth + 1);
    i = j + 1;
  }
  return out;
}

/* ───────────────────────── 特异性 ───────────────────────── */

function specificity(sel) {
  let s = sel.replace(/\\./g, ' \u0001 ').replace(/#/g, ' \u0002 ');
  const ids = (s.match(/\u0002/g) || []).length;
  const cls = (s.match(/\u0001/g) || []).length
    + (sel.match(/\[[^\]]*\]/g) || []).length
    + (sel.match(/(?<!:):(?!:)[a-z-]+/g) || []).length;
  const pseudoEl = (sel.match(/::[a-z-]+/g) || []).length;
  const types = (sel.replace(/\[[^\]]*\]/g, ' ').replace(/::?[a-z-]+(\([^)]*\))?/g, ' ')
    .match(/(^|[\s>+~(])([a-z][a-z0-9-]*)/gi) || []).length + pseudoEl;
  return ids * 10000 + cls * 100 + types;
}

/* ───────────── 值规范化：只用于 dist 产物等价性比对 ─────────────
   lightningcss 会做等价改写（::before→:before、rgba→#rrggbbaa、.06s→60ms、
   column-gap+row-gap→gap、right top→100% 0、animation 简写重排…）。
   这些不是回归，但会掩盖真实回归，所以先归一化再比。 */

function hexToRgba(hex) {
  const h = hex.slice(1);
  const ex = (s) => (s.length === 1 ? s + s : s);
  let r, g, b, a = '1';
  if (h.length === 3 || h.length === 4) {
    r = ex(h[0]); g = ex(h[1]); b = ex(h[2]); if (h.length === 4) a = String(parseInt(ex(h[3]), 16) / 255);
  } else {
    r = h.slice(0, 2); g = h.slice(2, 4); b = h.slice(4, 6); if (h.length === 8) a = String(parseInt(h.slice(6, 8), 16) / 255);
  }
  return 'rgba(' + [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), Number(Number(a).toFixed(4))].join(',') + ')';
}

function canonColor(v) {
  return v
    .replace(/#([0-9a-fA-F]{3,8})\b/g, (m) => hexToRgba(m))
    .replace(/rgba?\(([^()]*)\)/g, (m, inner) => {
      const parts = inner.split(',').map((x) => x.trim());
      const [r, g, b] = parts;
      const a = parts[3] === undefined ? 1 : Number(parts[3]);
      return 'rgba(' + [r, g, b, Number(a.toFixed(4))].join(',') + ')';
    })
    .replace(/\btransparent\b/g, 'rgba(0,0,0,0)');
}

const POS_KW = { left: '0', right: '100%', top: '0', bottom: '100%', center: '50%' };

function canonValue(prop, value) {
  let s = normWs(value);
  s = s.replace(/\s*,\s*/g, ',').replace(/\s*\/\s*/g, '/');
  // 时间 → ms
  s = s.replace(/(^|[^\w.-])(\d*\.?\d+)(ms|s)\b/g, (m, pre, n, u) => {
    const num = parseFloat(n);
    return pre + (u === 's' ? Math.round(num * 1000) : num) + 'ms';
  });
  s = canonColor(s);
  // transform：单参 translate 补 0
  s = s.replace(/translate\(([^,()]+)\)/g, 'translate($1,0)');
  // transform-origin：单值补 50%，left/right/center 归一
  if (prop === 'transform-origin') {
    s = s.replace(/\bleft\b/g, '0').replace(/\bright\b/g, '100%').replace(/\bcenter\b/g, '50%');
    if (!s.includes(' ')) s = s + ' 50%';
  }
  // stroke-width / stroke-dasharray：px 可省
  if (prop === 'stroke-width') s = s.replace(/(\d*\.?\d+)px/g, '$1');
  // background-position：关键字 → 百分比
  if (prop === 'background-position' || prop === 'background-position-x' || prop === 'background-position-y') {
    s = s.replace(/\b(left|right|top|bottom|center)\b/g, (m) => POS_KW[m]);
  }
  // animation / transition 简写：token 排序（两侧同样排序）
  if (prop === 'animation' || prop === 'transition') {
    s = splitTop(s, ' ').map((x) => x.trim()).filter(Boolean).sort().join(' ');
  }
  return s;
}

/** :is(a,b) 展开：lightningcss 会把"声明相同的相邻规则"合并成 :is(...)。
    等价性：:is() 的特异性取参数最大值，这里参数全是同一特异性，故与原选择器一致。 */
function expandIs(sel) {
  const idx = sel.indexOf(':is(');
  if (idx < 0) return [sel];
  let depth = 1, end = -1;
  for (let i = idx + 4; i < sel.length; i++) {
    if (sel[i] === '(') depth++;
    else if (sel[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return [sel];
  const inner = sel.slice(idx + 4, end);
  const pre = sel.slice(0, idx), post = sel.slice(end + 1);
  const out = [];
  for (const part of splitTop(inner, ',')) {
    for (const one of expandIs(pre + part.trim() + post)) out.push(one);
  }
  return out;
}

/** gap → row-gap / column-gap 展开（lightningcss 会合并长写） */
function expandGap(decls) {
  const out = new Map();
  for (const d of decls) {
    if (d.prop === 'gap') {
      const parts = d.value.trim().split(/\s+/);
      out.set('row-gap', parts[0]);
      out.set('column-gap', parts[1] ?? parts[0]);
      continue;
    }
    out.set(d.prop, d.value);
  }
  return out;
}

/* ───────────────────────── 构建两侧视图 ───────────────────────── */

async function loadNewSource() {
  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.css')).sort();
  const ordered = [];
  async function walk(file) {
    const css = await readFile(file, 'utf8');
    for (const line of css.split('\n')) {
      const m = line.match(/^\s*@import\s+(?:url\()?["']([^"']+)["']\)?\s*;\s*$/);
      if (m) { await walk(path.join(SRC_DIR, m[1])); continue; }
      ordered.push({ file, text: line });
    }
  }
  await walk(ENTRY);
  return { css: ordered.map((o) => o.text).join('\n'), files };
}

function buildView(parsed) {
  const final = new Map();          // "media|sel|prop" → {value, important, order}
  const localVars = new Map();      // "media|sel" → Map(customProp → value)
  for (const r of parsed.rules) {
    const key = r.media + '|' + r.sel;
    if (r.prop.startsWith('--')) {
      if (!localVars.has(key)) localVars.set(key, new Map());
      localVars.get(key).set(r.prop, r.value);
      continue;
    }
    final.set(r.media + '|' + r.sel + '|' + r.prop, { value: r.value, important: r.important, order: r.order });
  }
  return { final, localVars, rules: parsed.rules };
}

function resolveAll(view, rootDecls) {
  const rootVars = new Map();
  for (const d of rootDecls) if (d.prop.startsWith('--')) rootVars.set(d.prop, d.value);
  const out = new Map();
  for (const [key, entry] of view.final) {
    const parts = key.split('|');
    const local = view.localVars.get(parts[0] + '|' + parts[1]);
    const vars = local ? new Map([...rootVars, ...local]) : rootVars;
    out.set(key, { value: normWs(resolveVars(entry.value, vars)), important: entry.important, order: entry.order });
  }
  return out;
}

/* ───────────────────────── 主流程 ───────────────────────── */

const oldCss = await readFile(OLD_FILE, 'utf8');
const newSrc = await loadNewSource();

const oldParsed = parse(oldCss);
const newParsed = parse(newSrc.css);

const oldView = buildView(oldParsed);
const newView = buildView(newParsed);
const oldRes = resolveAll(oldView, oldParsed.rootDecls);
const newRes = resolveAll(newView, newParsed.rootDecls);

const oldSelectors = new Set(oldParsed.rules.map((r) => r.media + '|' + r.sel));
const newSelectors = new Set(newParsed.rules.map((r) => r.media + '|' + r.sel));

/* 1. 选择器存在性 */
const missing = [...oldSelectors].filter((k) => !newSelectors.has(k));
for (const k of missing) bad('选择器丢失: ' + k.replace('|', ' @ '));

/* 1b. 令牌（:root 自定义属性）逐个值比对：既有令牌一个都不许改值 */
const oldTokens = new Map(oldParsed.rootDecls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
const newTokens = new Map(newParsed.rootDecls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]));
for (const [name, value] of oldTokens) {
  if (!newTokens.has(name)) bad('令牌丢失: ' + name);
  else if (newTokens.get(name) !== value) bad('令牌值被改动: ' + name + '  旧 ' + value + ' → 新 ' + newTokens.get(name));
}

/* 2. 逐声明值一致性 */
let compared = 0;
for (const [key, o] of oldRes) {
  const n = newRes.get(key);
  const [media, sel, prop] = key.split('|');
  if (!n) { bad('声明丢失: ' + (media || 'base') + ' @ ' + sel + ' { ' + prop + ' }'); continue; }
  compared++;
  if (o.value !== n.value) bad('值不一致: ' + (media || 'base') + ' @ ' + sel + ' { ' + prop + ' }\n      旧: ' + o.value + '\n      新: ' + n.value);
  if (o.important !== n.important) bad('!important 不一致: ' + sel + ' { ' + prop + ' }');
}
for (const key of newRes.keys()) {
  if (!oldRes.has(key)) {
    const [media, sel, prop] = key.split('|');
    if (!NEW_SELECTOR_ALLOW.some((p) => sel.startsWith(p))) {
      bad('新增声明越界（不在契约白名单）: ' + (media || 'base') + ' @ ' + sel + ' { ' + prop + ' }');
    }
  }
}

/* 3. 层叠顺序一致性（同属性、同特异性） */
const buckets = new Map();
for (const [key, e] of oldRes) {
  const [media, sel, prop] = key.split('|');
  const b = media + '|' + prop + '|' + e.important + '|' + specificity(sel);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push({ sel, order: e.order, side: 'old' });
}
for (const [key, e] of newRes) {
  const [media, sel, prop] = key.split('|');
  const b = media + '|' + prop + '|' + e.important + '|' + specificity(sel);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push({ sel, order: e.order, side: 'new' });
}
let orderChecked = 0;
for (const [key, list] of buckets) {
  const olds = list.filter((x) => x.side === 'old').sort((a, b) => a.order - b.order).map((x) => x.sel);
  if (olds.length < 2) continue;
  const news = list.filter((x) => x.side === 'new').sort((a, b) => a.order - b.order).map((x) => x.sel)
    .filter((s) => olds.includes(s));
  orderChecked++;
  if (olds.join('\u0000') !== news.join('\u0000')) {
    bad('层叠顺序变化（' + key.split('|').slice(0, 2).join(' @ ') + '）\n      旧: ' + olds.join(' → ') + '\n      新: ' + news.join(' → '));
  }
}

/* 4. @keyframes */
for (const [name, body] of oldParsed.keyframes) {
  const n = newParsed.keyframes.get(name);
  if (n === undefined) bad('@keyframes 丢失: ' + name);
  else if (n !== body) bad('@keyframes 内容变化: ' + name + '\n      旧: ' + body + '\n      新: ' + n);
}
for (const name of newParsed.keyframes.keys()) {
  if (!oldParsed.keyframes.has(name)) bad('新增 @keyframes 未在契约内: ' + name);
}

/* 5. :root 唯一性 */
const rootHits = [];
for (const file of newSrc.files) {
  const css = stripComments(await readFile(path.join(SRC_DIR, file), 'utf8'));
  if (/(^|[^-\w]):root\b/.test(css)) rootHits.push(file);
}
if (rootHits.length !== 1) bad(':root 出现 ' + rootHits.length + ' 次（' + rootHits.join(', ') + '），必须恰好 1 次');
else if (rootHits[0] !== 'tokens.css') bad(':root 出现在 ' + rootHits[0] + '，只允许 tokens.css');

/* 6. 十六进制色值只允许在 tokens.css */
for (const file of newSrc.files) {
  if (file === 'tokens.css') continue;
  const css = stripComments(await readFile(path.join(SRC_DIR, file), 'utf8'));
  const hits = [];
  const re = /#([0-9a-fA-F]{3,8})\b/g;
  let m;
  while ((m = re.exec(css))) {
    const before = css[m.index - 1] || '';
    if (/[\w-]/.test(before)) continue;   // id 选择器（p#runtime）不算色值
    hits.push(m[0]);
  }
  if (hits.length) bad('十六进制色值出现在 ' + file + ': ' + [...new Set(hits)].join(', '));
}

/* 7. 产物语义等价：src 拼接 ↔ lightningcss 未压缩产物
   目的：证明打包器没有丢声明 / 改错值。等价改写先归一化再比；归一化后仍有差异
   的按 WARN 列出（人工确认），属性集合缺失/新增则直接 FAIL。 */
try {
  const debugCss = await readFile(path.join(DIST_DIR, 'main.debug.css'), 'utf8');
  const dParsed = parse(debugCss);

  const groupSrc = new Map();
  for (const r of newParsed.rules) {
    if (r.prop.startsWith('--')) continue;
    const k = r.media + '|' + r.sel;
    if (!groupSrc.has(k)) groupSrc.set(k, []);
    groupSrc.get(k).push({ prop: r.prop, value: r.value });
  }
  const groupDist = new Map();
  for (const r of dParsed.rules) {
    if (r.prop.startsWith('--')) continue;
    for (const sel of expandIs(canonSel(r.sel))) {
      const k = r.media + '|' + sel;
      if (!groupDist.has(k)) groupDist.set(k, []);
      groupDist.get(k).push({ prop: r.prop, value: r.value });
    }
  }

  let pipelineCompared = 0, pipelineWarn = 0;
  for (const [rawKey, decls] of groupSrc) {
    const [media, sel] = rawKey.split('|');
    const key = media + '|' + canonSel(sel);
    const distDecls = groupDist.get(key);
    if (!distDecls) { bad('打包器丢规则: ' + (media || 'base') + ' @ ' + sel); continue; }
    const a = expandGap(decls);
    const b = expandGap(distDecls);
    for (const [prop, val] of a) {
      pipelineCompared++;
      if (!b.has(prop)) { bad('打包器丢声明: ' + (media || 'base') + ' @ ' + sel + ' { ' + prop + ' }'); continue; }
      const ca = canonValue(prop, val);
      const cb = canonValue(prop, b.get(prop));
      if (ca !== cb) {
        pipelineWarn++;
        warn.push('打包器改写值（等价性需人工确认）: ' + sel + ' { ' + prop + ' }  ' + ca + '  ⇒  ' + cb);
      }
    }
    for (const prop of b.keys()) {
      if (!a.has(prop)) bad('打包器新增声明: ' + (media || 'base') + ' @ ' + sel + ' { ' + prop + ' }');
    }
  }

  // @keyframes：结构比对（帧偏移 + 每帧属性值，归一化后）
  const parseFrames = (body) => {
    const frames = [];
    let i = 0;
    while (i < body.length) {
      const open = body.indexOf('{', i);
      if (open < 0) break;
      const close = matchBrace(body, open);
      const offset = normWs(body.slice(i, open)).replace(/\bfrom\b/g, '0%').replace(/\bto\b/g, '100%');
      const map = new Map();
      for (const d of parseDecls(body.slice(open + 1, close))) map.set(d.prop, canonValue(d.prop, d.value));
      frames.push(offset + '{' + [...map].sort().map(([k, v]) => k + ':' + v).join(';') + '}');
      i = close + 1;
    }
    return frames.join('|');
  };
  for (const [name, body] of newParsed.keyframes) {
    const d = dParsed.keyframes.get(name);
    if (d === undefined) { bad('打包器丢 @keyframes: ' + name); continue; }
    if (parseFrames(body) !== parseFrames(d)) bad('打包器改写 @keyframes: ' + name);
  }
  console.log('  产物语义         src ↔ dist/main.debug.css 比对 ' + pipelineCompared + ' 条声明'
    + (pipelineWarn ? '（' + pipelineWarn + ' 条等价改写待确认）' : '（零差异）'));
} catch (e) {
  bad('dist/css/main.debug.css 不可读: ' + e.message);
}

/* 8. dist 产物：选择器覆盖 + 预算 */
let distInfo = null;
try {
  const manifest = JSON.parse(await readFile(path.join(DIST_DIR, 'manifest.json'), 'utf8'));
  const distFile = path.join(DIST_DIR, path.basename(manifest.file));
  const distCss = await readFile(distFile, 'utf8');
  const distParsed = parse(distCss);
  // minify 会做等价改写：::before → :before、:nth-child(1) → :first-child、*::before → :before
  // 这里把两侧归一到同一形态再比集合（只用于"选择器是否存在"，值比对仍走源码侧）
  const distSelectors = new Set(distParsed.rules.map((r) => r.media + '|' + canonSel(r.sel)));
  const missDist = [...oldSelectors].map((k) => k.split('|').map((x, i) => (i === 1 ? canonSel(x) : x)).join('|'))
    .filter((k) => !distSelectors.has(k));
  for (const k of missDist) bad('minified 产物缺选择器: ' + k.replace('|', ' @ '));
  const extra = [...distSelectors].filter((k) => !oldSelectors.has(k));
  const gz = zlib.gzipSync(Buffer.from(distCss), { level: 9 }).length;
  if (gz > BUDGET) bad('dist gzip ' + gz + ' B 超预算 ' + Math.round(BUDGET) + ' B');
  distInfo = {
    file: manifest.file,
    bytes: Buffer.byteLength(distCss),
    gzip: gz,
    selectors: distSelectors.size,
    extra: extra.length,
  };
} catch (e) {
  bad('dist 产物不可读（先跑 node scripts/build-css.mjs）: ' + e.message);
}

/* ───────────────────────── 报告 ───────────────────────── */

const oldBytes = Buffer.byteLength(oldCss);
const newBytes = Buffer.byteLength(newSrc.css);
const oldGz = zlib.gzipSync(Buffer.from(oldCss), { level: 9 }).length;

console.log('CSS parity · 旧 docs/architecture/metrics/v2-main.css ↔ 新 src/styles/*');
console.log('');
console.log('  文件            ' + newSrc.files.length + ' 个：' + newSrc.files.join(' '));
console.log('  选择器          旧 ' + oldSelectors.size + ' → 新 ' + newSelectors.size
  + '（新增 ' + [...newSelectors].filter((k) => !oldSelectors.has(k)).length + '，丢失 ' + missing.length + '）');
console.log('  新增选择器      ' + [...newSelectors].filter((k) => !oldSelectors.has(k))
  .map((k) => (k.includes('|') && k.split('|')[0] ? k.split('|')[1] + ' @' + k.split('|')[0] : k.replace('|', '')))
  .sort().join('  '));
console.log('  声明比对        ' + compared + ' 条（含 var() 递归解析）');
console.log('  层叠顺序检查    ' + orderChecked + ' 组');
console.log('  @keyframes      旧 ' + oldParsed.keyframes.size + ' → 新 ' + newParsed.keyframes.size);
console.log('  令牌           旧 ' + oldTokens.size + ' → 新 ' + newTokens.size
  + '（V3 新增 ' + (newTokens.size - oldTokens.size) + '，既有值改动 0）');
console.log('  源字节          旧 ' + oldBytes + ' B → 新 ' + newBytes + ' B（未压缩）');
if (distInfo) {
  console.log('  产物            ' + distInfo.file + ' · ' + distInfo.bytes + ' B · gzip ' + distInfo.gzip
    + ' B · 选择器 ' + distInfo.selectors);
  console.log('  旧 gzip         ' + oldGz + ' B → 新 gzip ' + distInfo.gzip + ' B（'
    + (oldGz - distInfo.gzip) + ' B / ' + (((oldGz - distInfo.gzip) / oldGz) * 100).toFixed(1) + '% 更小）');
}
console.log('');

if (warn.length) { console.log('WARN'); for (const w of warn) console.log('  · ' + w); console.log(''); }
if (fail.length) {
  console.error('FAIL ' + fail.length + ' 项');
  for (const f of fail) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('PASS 旧选择器 100% 存在 · 声明值一致 · 层叠顺序一致 · :root 唯一 · hex 仅在 tokens · gzip 在预算内');