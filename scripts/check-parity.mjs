#!/usr/bin/env node
// check-parity.mjs —— 新旧 URL 集合对比（基线：线上 sitemap 80 条）。
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import fg from 'fast-glob';

const baselineFile = 'docs/architecture/metrics/urls-baseline.txt';
if (!existsSync(baselineFile)) { console.error('[parity] 缺基线文件'); process.exit(1); }

const norm = (u) => {
  let s = u.trim();
  if (!s) return null;
  s = decodeURI(s);
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/') && !/\.[a-z0-9]+$/i.test(s)) s += '/';
  return s;
};

const baseline = new Set(readFileSync(baselineFile, 'utf8').split('\n').map(norm).filter(Boolean));
const dist = fg.sync('dist/**/*.html', { absolute: false });
const actual = new Set(
  dist
    .filter((f) => !f.endsWith('404.html'))
    .map((f) => f.split(sep).join('/').replace(/^dist\//, ''))
    .map((f) => '/' + f)
    .map((u) => u.replace(/index\.html$/, ''))
    .map(norm)
);

const missing = [...baseline].filter((u) => !actual.has(u));
const extra = [...actual].filter((u) => !baseline.has(u));

console.log(`[parity] 基线 ${baseline.size} · 产物 ${actual.size} · 缺 ${missing.length} · 多 ${extra.length}`);
if (missing.length) {
  console.error('  缺失：' + missing.slice(0, 20).join(' '));
  process.exit(1);
}
if (extra.length) console.log('  新增（允许）：' + extra.slice(0, 20).join(' '));
console.log('[parity] ok');
