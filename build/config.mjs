/** build/config.mjs — 路径、站点配置、资源指纹解析 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from './toml.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 运行时实时同步的内容源（模板写进 <html data-content-base>，静态页内容不受影响） */
export const CONTENT_BASE =
  process.env.CONTENT_BASE || 'https://cdn.jsdelivr.net/gh/K-Blaaaack/articles@main';

/** 主源不可用时的回退源（<html data-content-fallback>） */
export const CONTENT_FALLBACK =
  process.env.CONTENT_FALLBACK || 'https://raw.githubusercontent.com/K-Blaaaack/articles/main';

export const DIST_DIR = path.join(ROOT, 'dist');
export const STATIC_DIR = path.join(ROOT, 'static');
export const DATA_DIR = path.join(ROOT, 'data');

/** CONTENT_DIR 优先；否则 .cache/content；再否则同级 ../articles（本地双仓开发）（契约 §3.1） */
export function resolveContentDir() {
  const fromEnv = process.env.CONTENT_DIR;
  if (fromEnv) {
    const abs = path.resolve(ROOT, fromEnv);
    if (!fs.existsSync(abs)) throw new Error(`CONTENT_DIR 不存在: ${abs}`);
    return abs;
  }
  const cached = path.join(ROOT, '.cache', 'content');
  if (fs.existsSync(cached)) return cached;
  const sibling = path.resolve(ROOT, '..', 'articles');
  if (fs.existsSync(sibling)) return sibling;
  throw new Error('找不到内容仓库：请运行 node scripts/fetch-content.mjs，或设置 CONTENT_DIR');
}

export function readData(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`缺少数据文件: data/${name}`);
  return parseToml(fs.readFileSync(file, 'utf8'), `data/${name}`);
}

function required(obj, key, file) {
  const v = obj[key];
  if (v === undefined || v === null || v === '') throw new Error(`data/${file} 缺少必填项: ${key}`);
  return v;
}

/** 站点级配置（原 hugo.toml [params] 的迁移落点，见契约 §3.6） */
export function loadSite() {
  const d = readData('site.toml');
  const site = {
    title: required(d, 'title', 'site.toml'),
    base: required(d, 'base', 'site.toml').replace(/\/+$/, '') + '/',
    lang: d.lang || 'zh-cn',
    description: d.description || '',
    author: d.author || d.title,
    email: d.email || '',
    startTime: d.start_time || '',
    lastDeploy: d.last_deploy || '',
    github: d.github || '',
    githubHomepage: d.github_homepage || d.github || '',
    githubSource: d.github_source || '',
    nav: Array.isArray(d.nav) ? d.nav : [],
    footer: d.footer || {},
  };
  if (!site.nav.length) throw new Error('data/site.toml 缺少 [[nav]] 导航项');
  return site;
}

/** 站内绝对 URL（未编码） */
export function absUrl(site, p) {
  return site.base.replace(/\/$/, '') + p;
}

/** 中文路径 percent-encode，与线上 sitemap 一致 */
export function encodePath(p) {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function readManifest(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} 不是合法 JSON: ${err.message}`);
  }
}

/**
 * 解析 dist/css 与 dist/js 的指纹产物（stylist / kernel 产出）。
 * 优先读 manifest.json（集成契约）；读不到时降级 glob，并在日志里 warn。
 * @returns {{css: string, js: string, notes: string[]}}
 */
export function resolveAssets() {
  const notes = [];
  const cssManifest = readManifest(path.join(DIST_DIR, 'css', 'manifest.json'));
  const jsManifest = readManifest(path.join(DIST_DIR, 'js', 'manifest.json'));

  let css = cssManifest && typeof cssManifest.file === 'string' ? cssManifest.file : null;
  let js = jsManifest && typeof jsManifest.entry === 'string' ? '/js/' + jsManifest.entry : null;

  const pick = (dir, re) => {
    if (!fs.existsSync(dir)) return null;
    const hits = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
    return hits.length ? hits[hits.length - 1] : null;
  };

  if (!css) {
    const found = pick(path.join(DIST_DIR, 'css'), /^main\.[0-9a-f]{8,}\.css$/);
    css = found ? '/css/' + found : '/css/main.css';
    notes.push(`dist/css/manifest.json 缺失或无效，降级为 ${css}`);
  }
  if (!js) {
    const found = pick(path.join(DIST_DIR, 'js'), /^main\.[0-9a-f]{8,}\.js$/);
    js = found ? '/js/' + found : '/js/main.js';
    notes.push(`dist/js/manifest.json 缺失或无效，降级为 ${js}`);
  }
  if (css === '/css/main.css') notes.push('dist/css 无指纹产物，HTML 引用 /css/main.css');
  if (js === '/js/main.js') notes.push('dist/js 无指纹产物，HTML 引用 /js/main.js');

  return { css, js, notes };
}

/** 日期格式化：统一按内容源的 +08:00 输出，不依赖构建机时区 */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OFFSET_MIN = 8 * 60;

function shifted(date) {
  return new Date(date.getTime() + OFFSET_MIN * 60 * 1000);
}
const pad = (n) => String(n).padStart(2, '0');

/** 2026-10-17T15:00:00+08:00 */
export function isoShanghai(date) {
  const d = shifted(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`;
}

/** Sat, 17 Oct 2026 15:00:00 +0800 */
export function rfc1123Shanghai(date) {
  const d = shifted(date);
  return `${WEEKDAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0800`;
}

/** 2026/10（文章列表页左侧角标） */
export function monthPath(date) {
  const d = shifted(date);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}`;
}

/** 2026/10/17（首页新闻条目日期，对应 Hugo 的 "2006/01/02"） */
export function dayPath(date) {
  const d = shifted(date);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

/** 2026-10-17（文章页头部日期，对应 Hugo 的 "2006-01-02"） */
export function isoDay(date) {
  const d = shifted(date);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 构建期时间戳（meta.json.generated_at） */
export function nowIso() {
  return new Date().toISOString();
}
