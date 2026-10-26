#!/usr/bin/env node
// check-links.mjs —— 内部链接与资源引用检查（dist/ 全量 HTML）。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve as resolvePath } from 'node:path';
import fg from 'fast-glob';

const DIST = resolvePath('dist');
const files = await fg('**/*.html', { cwd: DIST, absolute: true });
const failures = [];
let checked = 0;

const ATTR = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  let m;
  while ((m = ATTR.exec(html))) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(raw)) continue;

    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;
    checked++;

    let target = clean.startsWith('/')
      ? join(DIST, decodeURIComponent(clean))
      : join(dirname(file), decodeURIComponent(clean));

    if (clean.endsWith('/')) target = join(target, 'index.html');
    else if (!extname(target)) target = join(target, 'index.html');

    if (!existsSync(target)) {
      failures.push({ file: file.replace(DIST, ''), href: raw });
    } else if (statSync(target).isDirectory()) {
      if (!existsSync(join(target, 'index.html'))) failures.push({ file: file.replace(DIST, ''), href: raw + ' (目录无 index)' });
    }
  }
}

if (failures.length) {
  console.error(`[links] ${failures.length} 个死链 / 共 ${checked} 条引用`);
  for (const f of failures.slice(0, 30)) console.error(`  ${f.file} → ${f.href}`);
  process.exit(1);
}
console.log(`[links] ok · ${checked} 条引用 · ${files.length} 页`);
