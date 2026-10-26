#!/usr/bin/env node
// check-tokens.mjs —— 令牌唯一性与色值集中度。
import { readFileSync, existsSync } from 'node:fs';
import fg from 'fast-glob';

const files = fg.sync('src/styles/*.css', { absolute: true });
if (!files.length) { console.error('[tokens] src/styles 为空'); process.exit(1); }

const roots = [];
const hexes = [];

for (const f of files) {
  const css = readFileSync(f, 'utf8');
  const name = f.split('/').pop();
  const rootCount = (css.match(/:root\s*\{/g) || []).length;
  if (rootCount) roots.push({ name, rootCount });
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  if (name !== 'tokens.css' && hex.length) hexes.push({ name, hex: [...new Set(hex)].slice(0, 8) });
}

let bad = 0;
if (roots.length !== 1 || roots[0].name !== 'tokens.css') {
  console.error('[tokens] :root 必须且只能出现在 tokens.css：' + JSON.stringify(roots));
  bad = 1;
}
if (hexes.length) {
  console.error('[tokens] tokens.css 之外出现十六进制色值：' + JSON.stringify(hexes));
  bad = 1;
}
if (bad) process.exit(1);
console.log('[tokens] ok · :root 唯一 · 无游离色值');
