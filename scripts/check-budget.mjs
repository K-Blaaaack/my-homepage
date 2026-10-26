#!/usr/bin/env node
// check-budget.mjs —— 体积预算门禁。
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import fg from 'fast-glob';

const KB = 1024;
const LIMITS = {
  css: Number(process.env.BUDGET_CSS_KB || 9.9),
  js: Number(process.env.BUDGET_JS_KB || 6.0),
  home: Number(process.env.BUDGET_HOME_KB || 4.5),
  page: Number(process.env.BUDGET_PAGE_KB || 55),
};

const gz = (p) => gzipSync(readFileSync(p), { level: 9 }).length;

function biggest(pattern) {
  const files = fg.sync(pattern, { absolute: true });
  if (!files.length) return null;
  return files.sort((a, b) => gz(b) - gz(a))[0];
}

const rows = [];
const fail = [];

function add(label, file, limitKB) {
  if (!file) { rows.push([label, '缺失', '—', 'FAIL']); fail.push(label); return; }
  const g = gz(file) / KB;
  const raw = statSync(file).size / KB;
  const ok = g <= limitKB;
  rows.push([label, `${raw.toFixed(1)} KB`, `${g.toFixed(2)} KB`, ok ? 'ok' : 'FAIL']);
  if (!ok) fail.push(`${label} gzip ${g.toFixed(2)} > ${limitKB} KB`);
}

add('CSS', biggest('dist/css/main.*.css'), LIMITS.css);
add('JS', biggest('dist/js/main.*.js'), LIMITS.js);
add('首页 HTML', 'dist/index.html', LIMITS.home);

const pages = fg.sync('dist/**/*.html', { absolute: true }).sort((a, b) => gz(b) - gz(a));
if (pages[0]) {
  const raw = statSync(pages[0]).size / KB;
  rows.push(['最大页', pages[0].replace(/^.*dist/, ''), `${raw.toFixed(1)} KB`, raw <= LIMITS.page ? 'ok' : 'FAIL']);
  if (raw > LIMITS.page) fail.push(`最大页 ${raw.toFixed(1)} KB > ${LIMITS.page} KB`);
}

console.log('[budget] 项目 / 原始 / gzip / 判定');
for (const r of rows) console.log('  ' + r.join('  '));

if (fail.length) { console.error('[budget] 超预算：' + fail.join('; ')); process.exit(1); }
console.log('[budget] ok');
