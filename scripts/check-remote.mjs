#!/usr/bin/env node
// check-remote.mjs —— 运行时同步契约门禁（实时更新能力是否真的接上）。
import { readFileSync, existsSync } from 'node:fs';
import fg from 'fast-glob';

const problems = [];
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const home = read('dist/index.html');
if (!home) problems.push('缺少 dist/index.html');
else {
  if (!/data-content-base="https?:\/\//.test(home)) problems.push('首页缺 <html data-content-base>');
  if (!/id="postItemTpl"/.test(home)) problems.push('首页缺 <template id="postItemTpl">');
  if (!/data-remote-list="home"/.test(home)) problems.push('首页缺 data-remote-list="home"');
}

const list = read('dist/posts/index.html');
if (!list) problems.push('缺少 dist/posts/index.html');
else if (!/data-remote-list="posts"/.test(list)) problems.push('/posts/ 缺 data-remote-list="posts"');

const nf = read('dist/404.html');
if (!nf) problems.push('缺少 dist/404.html');
else {
  if (!/data-page="404"/.test(nf)) problems.push('404 缺 data-page="404"');
  if (!/id="remoteArticle"/.test(nf)) problems.push('404 缺 #remoteArticle 容器');
  if (/id="loader"/.test(nf)) problems.push('404 不应有 #loader');
}

const entry = fg.sync('src/js/main.js', { absolute: false })[0];
if (entry) {
  const src = read(entry);
  if (/^import\s+[^;]*from\s+['"]\.\/remote/m.test(src)) problems.push('main.js 静态 import 了 remote（应动态 import）');
  if (/^import\s+[^;]*from\s+['"]marked/m.test(src)) problems.push('main.js 静态 import 了 marked');
}

const remoteFile = ['src/js/remote.js', 'src/js/remote.mjs'].find(existsSync);
if (!remoteFile) problems.push('缺少 src/js/remote.js');
else {
  const src = read(remoteFile);
  if (!/catch/.test(src)) problems.push('remote.js 缺失败路径（catch）');
  if (!/no-cache|no-store/.test(src)) problems.push('remote.js 未设置 cache 策略');
  if (!/setTimeout|timeout|AbortController/.test(src)) problems.push('remote.js 缺超时控制');
}

const overlaySrc = read('src/js/overlay.js');
if (!overlaySrc) problems.push('缺少 src/js/overlay.js');
else {
  if (!/dataset\.page[^\n]{0,40}post/.test(overlaySrc)) problems.push('overlay.js 的目录未限定在 data-page="post"（会出现在首页/独立页）');
  if (!/\.post-content/.test(overlaySrc)) problems.push('overlay.js 的目录未限定在 .post-content 内');
}

const chunks = fg.sync('dist/js/chunk-*.js', { absolute: false });
if (!chunks.length) problems.push('dist/js 没有分包（运行时同步必须是按需 chunk）');

if (problems.length) {
  console.error('[remote] FAIL');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('[remote] ok · 运行时同步钩子齐备 · ' + chunks.length + ' 个按需 chunk');
