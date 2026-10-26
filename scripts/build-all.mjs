#!/usr/bin/env node
// build-all.mjs —— 构建编排：CSS → JS → 站点。任一步失败即中止（不吞错误）。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const steps = [
  { name: 'css', file: 'scripts/build-css.mjs', out: 'dist/css' },
  { name: 'js', file: 'scripts/build-js.mjs', out: 'dist/js' },
  { name: 'site', file: 'build/index.mjs', out: 'dist' },
];

const only = process.argv.slice(2);
const started = Date.now();
let failed = 0;

for (const step of steps) {
  if (only.length && !only.includes(step.name)) continue;
  if (!existsSync(step.file)) {
    console.error(`[build] 缺少 ${step.file}（${step.name} 阶段尚未实现）`);
    failed = 1;
    continue;
  }
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [step.file], { stdio: 'inherit' });
  const ms = Date.now() - t0;
  if (res.status !== 0) {
    console.error(`[build] ${step.name} 失败，退出码 ${res.status}`);
    failed = 1;
    break;
  }
  console.log(`[build] ${step.name} ok · ${ms} ms`);
}

console.log(`[build] ${failed ? 'FAILED' : 'done'} · ${Date.now() - started} ms`);
process.exit(failed);
