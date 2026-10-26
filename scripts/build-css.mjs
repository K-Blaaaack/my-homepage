#!/usr/bin/env node
/**
 * K-BLACK V3 · CSS 打包器（stylist 作用域）
 * ---------------------------------------------------------------------------
 * 输入  src/styles/main.css（只含 @import，7 层）
 * 处理  自解析 @import → lightningcss transform（targets: chrome100/safari15/firefox100）
 * 输出  dist/css/main.<hash8>.css   minify 产物（线上唯一引用）
 *       dist/css/main.debug.css   未压缩产物（同一次 transform，排查用）
 *       dist/css/manifest.json    { file, hash, bytes, gzip }
 *
 * 规则：不 rm -rf dist；只清理 dist/css 下本脚本自己产出的旧 main.<hash8>.css。
 */
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src/styles');
const ENTRY = path.join(SRC, 'main.css');
const OUT = path.join(ROOT, 'dist/css');

const TARGETS = { chrome: 100 << 16, safari: 15 << 16, firefox: 100 << 16 };
const GZIP_BUDGET = 9.9 * 1024;

/** 递归内联 @import "x.css";（相对路径，只允许 src/styles 内部） */
async function inline(file, seen = new Set()) {
  if (seen.has(file)) throw new Error('循环 @import: ' + file);
  seen.add(file);
  const css = await readFile(file, 'utf8');
  const lines = css.split('\n');
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*@import\s+(?:url\()?["']([^"']+)["']\)?\s*;\s*$/);
    if (!m) { out.push(line); continue; }
    const target = path.resolve(path.dirname(file), m[1]);
    if (!target.startsWith(SRC + path.sep)) throw new Error('@import 越界: ' + m[1]);
    out.push(await inline(target, seen));
  }
  return out.join('\n');
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

const source = await inline(ENTRY);

// 未压缩（同一 targets，便于对照 minify 前后的差异）
const pretty = transform({
  filename: ENTRY,
  code: Buffer.from(source),
  minify: false,
  targets: TARGETS,
  sourceMap: false,
});

const min = transform({
  filename: ENTRY,
  code: Buffer.from(source),
  minify: true,
  targets: TARGETS,
  sourceMap: false,
});

for (const w of [...pretty.warnings, ...min.warnings]) {
  console.warn('[lightningcss]', w.message, w.loc ? `${w.loc.filename}:${w.loc.line}` : '');
}

const hash = crypto.createHash('sha256').update(min.code).digest('hex').slice(0, 8);
const fileName = `main.${hash}.css`;

await mkdir(OUT, { recursive: true });

// 清理本脚本产出的旧指纹文件（仅 dist/css/main.<8hex>.css）
for (const f of await readdir(OUT)) {
  if (/^main\.[0-9a-f]{8}\.css$/.test(f) && f !== fileName) {
    await unlink(path.join(OUT, f));
    console.log('clean  dist/css/' + f);
  }
}

await writeFile(path.join(OUT, fileName), min.code);
await writeFile(path.join(OUT, 'main.debug.css'), pretty.code);

const manifest = {
  file: '/css/' + fileName,
  hash,
  bytes: min.code.length,
  gzip: gzipSize(min.code),
  source_bytes: Buffer.byteLength(source),
  debug: '/css/main.debug.css',
  targets: { chrome: 100, safari: 15, firefox: 100 },
};
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const srcBytes = Buffer.byteLength(source);
const prettyBytes = pretty.code.length;
console.log('');
console.log('CSS build');
console.log('  source (7 layers)   ' + String(srcBytes).padStart(7) + ' B');
console.log('  lightningcss pretty ' + String(prettyBytes).padStart(7) + ' B');
console.log('  minified            ' + String(manifest.bytes).padStart(7) + ' B  → dist/css/' + fileName);
console.log('  gzip -9             ' + String(manifest.gzip).padStart(7) + ' B  (budget ' + GZIP_BUDGET + ' B = 9.9 KB)');
console.log('  hash                ' + hash);

if (manifest.gzip > GZIP_BUDGET) {
  console.error('\nFAIL  CSS gzip ' + manifest.gzip + ' B 超预算 ' + Math.round(GZIP_BUDGET) + ' B');
  process.exit(1);
}
console.log('  OK    gzip 在预算内（余量 ' + (GZIP_BUDGET - manifest.gzip) + ' B）');
