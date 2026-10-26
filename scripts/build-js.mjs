#!/usr/bin/env node
/**
 * scripts/build-js.mjs —— 运行时内核打包（kernel 作用域）
 *
 * 产物：
 *   dist/js/main.<hash8>.js      入口（<script type="module">），gzip ≤ 6 KB
 *   dist/js/chunk-<hash8>.js     动态分包（overlay.js：搜索 / 目录 / 页面增强）
 *   dist/js/debug/main.js        未压缩版 + sourcemap，便于排查
 *   dist/js/manifest.json        文件名与体积清单（供模板引用与门禁）
 *
 * hash8 = 产物内容的 sha256 前 8 位十六进制（与现有 main.<hash8>.css 同一约定）。
 * 只清理 dist/js 下自己产出的文件；不碰 dist/ 其它子目录，不 rm -rf。
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'js');
const TMP = join(OUT, '.build');
const DEBUG_OUT = join(OUT, 'debug');
const ENTRY = join(ROOT, 'src', 'js', 'main.js');
const BUDGET = 6144; // 入口 gzip 上限（契约 §6：JS gzip ≤ 6 KB）

const kb = (n) => (n / 1024).toFixed(2) + ' KB';
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

async function cleanOwnArtifacts() {
  await mkdir(OUT, { recursive: true });
  for (const name of await readdir(OUT)) {
    if (/^main\.[0-9a-zA-Z]+\.js(\.map)?$/.test(name) || /^chunk-[0-9a-zA-Z]+\.js(\.map)?$/.test(name)) {
      await rm(join(OUT, name), { force: true });
    }
  }
  await rm(TMP, { recursive: true, force: true });
  await rm(DEBUG_OUT, { recursive: true, force: true });
  await mkdir(DEBUG_OUT, { recursive: true });
}

/** 固定名构建 → 按内容改名 → 回写 chunk 引用，得到真正的内容哈希。 */
async function buildProd() {
  await build({
    entryPoints: { main: ENTRY },
    outdir: TMP,
    bundle: true,
    format: 'esm',
    splitting: true,
    target: ['es2020'],
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    entryNames: 'main',
    chunkNames: 'chunk-[name]',
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const files = (await readdir(TMP)).filter((f) => f.endsWith('.js'));
  const sources = new Map();
  for (const f of files) sources.set(f, await readFile(join(TMP, f), 'utf8'));

  // 1) 先给 chunk 定名（chunk 内容不引用其它 chunk，顺序安全）
  const renamed = new Map();
  for (const [name, src] of sources) {
    if (name === 'main.js') continue;
    renamed.set(name, 'chunk-' + hash8(Buffer.from(src)) + '.js');
  }
  for (const [oldName, newName] of renamed) {
    await writeFile(join(OUT, newName), sources.get(oldName));
  }

  // 2) 入口：回写 chunk 引用后再算哈希，保证 hash 与字节一一对应
  let entrySrc = sources.get('main.js');
  for (const [oldName, newName] of renamed) {
    entrySrc = entrySrc.split(oldName).join(newName);
  }
  const entryName = 'main.' + hash8(Buffer.from(entrySrc)) + '.js';
  await writeFile(join(OUT, entryName), entrySrc);

  return { entryName, chunks: Array.from(renamed.values()) };
}

async function buildDebug() {
  await build({
    entryPoints: { main: ENTRY },
    outdir: DEBUG_OUT,
    bundle: true,
    format: 'esm',
    splitting: true,
    target: ['es2020'],
    minify: false,
    sourcemap: 'linked',
    charset: 'utf8',
    entryNames: 'main',
    chunkNames: 'chunk-[name]',
    metafile: true,
    logLevel: 'silent',
  });
}

async function main() {
  const t0 = Date.now();
  await cleanOwnArtifacts();

  const { entryName, chunks } = await buildProd();
  await buildDebug();
  await rm(TMP, { recursive: true, force: true });

  const names = [entryName, ...chunks].sort();
  const rows = [];
  for (const name of names) {
    const buf = await readFile(join(OUT, name));
    rows.push({ file: 'dist/js/' + name, bytes: buf.length, gzip: gz(buf), content: buf.toString('utf8') });
  }
  const entry = rows.find((r) => r.file.endsWith(entryName));
  if (!entry) throw new Error('入口产物缺失：' + entryName);
  if (!/\/main\.[0-9a-f]{8}\.js$/.test(entry.file)) throw new Error('入口 hash 不是 8 位十六进制：' + entry.file);
  for (const c of chunks) if (!/^chunk-[0-9a-f]{8}\.js$/.test(c)) throw new Error('分包 hash 异常：' + c);

  // 产物自检：必须是可解析的 ESM，且不含 CJS
  for (const r of rows) {
    if (/\brequire\(/.test(r.content)) throw new Error('产物含 CJS require：' + r.file);
    if (!/^\s*(import|export|const|var|let|function|"use strict")/.test(r.content)) throw new Error('产物首行异常：' + r.file);
  }

  const devFiles = (await readdir(DEBUG_OUT)).filter((f) => f.endsWith('.js'));
  const manifest = {
    built_at: new Date().toISOString(),
    entry: entryName,
    entry_bytes: entry.bytes,
    entry_gzip: entry.gzip,
    budget_gzip: BUDGET,
    budget_ok: entry.gzip <= BUDGET,
    chunks: rows.filter((r) => r !== entry).map((r) => ({ file: basename(r.file), bytes: r.bytes, gzip: r.gzip })),
    debug: devFiles.sort(),
    build_ms: Date.now() - t0,
  };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('─'.repeat(66));
  console.log(' 运行时内核打包  (esbuild / esm / splitting / target es2020 / minify)');
  console.log('─'.repeat(66));
  for (const r of rows) console.log(' ' + r.file.padEnd(34) + kb(r.bytes).padStart(10) + '  gzip ' + kb(r.gzip).padStart(9));
  console.log('─'.repeat(66));
  console.log(' 入口 gzip ' + kb(entry.gzip) + ' / 预算 ' + kb(BUDGET) + '  ' + (entry.gzip <= BUDGET ? '✓' : '✗ 超预算'));
  console.log(' 分包 ' + (rows.length - 1) + ' 个，合计 gzip ' + kb(rows.filter((r) => r !== entry).reduce((n, c) => n + c.gzip, 0)));
  console.log(' 未压缩版 dist/js/debug/：' + manifest.debug.join(', '));
  console.log(' 用时 ' + (Date.now() - t0) + ' ms');

  if (entry.gzip > BUDGET) {
    console.error('✗ 入口 gzip 超预算：' + kb(entry.gzip) + ' > ' + kb(BUDGET));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[build-js] 失败：' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
