#!/usr/bin/env node
// check-boot.mjs —— 启动序列真实性静态检查（把「不许假装」写成规则）。
import { readFileSync, existsSync } from 'node:fs';

const file = ['src/js/boot.js', 'src/js/boot.mjs'].find(existsSync);
if (!file) { console.error('[boot] 找不到 src/js/boot.js'); process.exit(1); }

const src = readFileSync(file, 'utf8');
const start = src.indexOf('STAGES');
if (start < 0) { console.error('[boot] 找不到 STAGES 定义'); process.exit(1); }
const open = src.indexOf('[', start);
const close = src.indexOf('\n];', open) >= 0 ? src.indexOf('\n];', open) : src.indexOf('];', open);
const block = src.slice(open, close + 2);

const chunks = block.split(/\{\s*\n?\s*id:/).slice(1).map((c) => 'id:' + c);
const problems = [];

if (chunks.length !== 6) problems.push(`stage 数量 ${chunks.length}，契约要求 6`);
if (/setTimeout|setInterval/.test(block)) problems.push('STAGES 定义中出现 setTimeout/setInterval');

for (const c of chunks) {
  const id = (c.match(/id:\s*'([^']+)'/) || [])[1] || '?';
  if (!/weight:\s*\d+/.test(c)) problems.push(`${id}: 缺 weight`);
  if (!/await|fetch\(|decode\(|import\(/.test(c)) problems.push(`${id}: run 内没有真实异步工作`);
}

// 行渲染必须是「阶段解析后写入」，而不是预置文案：要求存在把 stage 结果写进终端的调用
if (!/onLine|term\.write|writeLine/.test(src)) problems.push('缺少阶段结果写入终端的调用');
if (!/fail|catch/.test(src)) problems.push('缺少失败路径');

if (problems.length) {
  console.error('[boot] FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`[boot] ok · ${chunks.length} 个真实检查点`);
