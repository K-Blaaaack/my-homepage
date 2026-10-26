#!/usr/bin/env node
// check-all.mjs —— 依次跑全部门禁，任一失败即非 0。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const checks = [
  ['tokens', 'scripts/check-tokens.mjs'],
  ['boot', 'scripts/check-boot.mjs'],
  ['links', 'scripts/check-links.mjs'],
  ['budget', 'scripts/check-budget.mjs'],
  ['parity', 'scripts/check-parity.mjs'],
  ['css', 'scripts/check-css-parity.mjs'],
  ['html', null], // html-validate，单独处理
];

let failed = 0;
for (const [name, file] of checks) {
  if (!file) continue;
  if (!existsSync(file)) { console.log(`[check] ${name} 跳过（未实现）`); continue; }
  const res = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (res.status !== 0) { console.error(`[check] ${name} FAILED`); failed = 1; }
}

if (existsSync('node_modules/.bin/html-validate') && existsSync('dist')) {
  const res = spawnSync('node_modules/.bin/html-validate', ['--config', '.htmlvalidate.json', 'dist/**/*.html'], { stdio: 'inherit' });
  if (res.status !== 0) { console.error('[check] html FAILED'); failed = 1; }
}

console.log(failed ? '[check] FAILED' : '[check] all ok');
process.exit(failed);
