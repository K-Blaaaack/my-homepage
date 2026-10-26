#!/usr/bin/env node
/**
 * build/index.mjs — V3 构建入口（替代 Hugo）
 *
 *   node build/index.mjs                       # CONTENT_DIR 默认 ./content
 *   CONTENT_DIR=../articles node build/index.mjs
 *
 * 流程：load → render（全内存）→ 清理自有产物 → emit → report
 * 任何一步抛错都以非 0 退出，不静默跳过坏文章（契约 §3.1）。
 */

import fs from 'node:fs';
import path from 'node:path';

import { DIST_DIR, resolveContentDir, loadSite, readData, resolveAssets } from './config.mjs';
import { loadContent } from './content.mjs';
import { buildMediaIndex, emitMedia, emitStatic } from './media.mjs';
import { buildRoutes } from './routes.mjs';
import { createRenderer } from './render.mjs';
import { buildManifest } from './manifest.mjs';
import { buildSearchIndex } from './search.mjs';
import { sitemapXml, robotsTxt, rssXml } from './feeds.mjs';

const STATIC_DIR = path.join(DIST_DIR, '..', 'static');
const PROTECTED_DIRS = new Set(['css', 'js', 'img']);

function writeOut(rel, content) {
  const dest = path.join(DIST_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return Buffer.byteLength(content);
}

/** 只清理 builder 自己产出的路径，绝不 rm -rf dist（契约 §1 硬规则） */
function cleanOwned(routes) {
  const dirs = new Set(['media', 'search']);
  const files = new Set(['index.html', '404.html', 'sitemap.xml', 'robots.txt', 'index.xml', 'meta.json']);
  for (const route of routes) {
    const seg = route.out.split('/');
    if (seg.length > 1) dirs.add(seg[0]);
  }
  for (const d of PROTECTED_DIRS) dirs.delete(d);
  for (const d of dirs) fs.rmSync(path.join(DIST_DIR, d), { recursive: true, force: true });
  for (const f of files) fs.rmSync(path.join(DIST_DIR, f), { force: true });
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function main() {
  const started = performance.now();

  const contentDir = resolveContentDir();
  const site = loadSite();
  const data = {
    home: readData('home.toml'),
    news: readData('news.toml'),
    stack: readData('stack.toml'),
    links: readData('links.toml'),
  };

  const { posts, pages, tags, skipped } = loadContent(contentDir);
  const mediaIndex = buildMediaIndex({ posts });
  const assets = resolveAssets();
  const routes = buildRoutes({ posts, pages, tags });

  const year = new Date().getUTCFullYear();
  const renderer = createRenderer({ site, data, mediaIndex, assets, year, posts, pages });

  // 2) 全内存渲染，任何一篇坏掉都在写盘前失败
  const rendered = routes.map((route) => ({ route, html: renderer.renderRoute(route) }));

  // 3) 写盘
  fs.mkdirSync(DIST_DIR, { recursive: true });
  cleanOwned(routes);

  let htmlBytes = 0;
  for (const { route, html } of rendered) htmlBytes += writeOut(route.out, html);

  const mediaCount = emitMedia({ mediaIndex, distDir: DIST_DIR });
  const staticCount = emitStatic({ staticDir: STATIC_DIR, distDir: DIST_DIR });

  const sitemap = sitemapXml({ site, routes, posts, tags });
  const siteRss = rssXml({
    site,
    posts,
    channelTitle: site.title,
    channelPath: '/',
    selfPath: '/index.xml',
    description: site.description,
  });
  const postsRss = rssXml({
    site,
    posts,
    channelTitle: `Posts on ${site.title}`,
    channelPath: '/posts/',
    selfPath: '/posts/index.xml',
    description: `Recent content in Posts on ${site.title}`,
  });
  const robots = robotsTxt({ site });
  const manifest = buildManifest({ site, posts, pages, tags });
  const searchIndex = buildSearchIndex({ posts });

  const xmlBytes =
    writeOut('sitemap.xml', sitemap) +
    writeOut('robots.txt', robots) +
    writeOut('index.xml', siteRss) +
    writeOut('posts/index.xml', postsRss);
  const jsonBytes =
    writeOut('meta.json', JSON.stringify(manifest, null, 2) + '\n') +
    writeOut('search/index.json', JSON.stringify(searchIndex) + '\n');

  // 4) 报告
  const counts = routes.reduce((acc, r) => {
    acc[r.kind] = (acc[r.kind] || 0) + 1;
    return acc;
  }, {});
  const ms = Math.round(performance.now() - started);

  const lines = [
    `K-BLACK build v3 — ${routes.length} pages in ${ms} ms`,
    `  content   ${contentDir}`,
    `            ${posts.length} posts · ${pages.length} pages · ${tags.length} tags · ${mediaIndex.size} media`,
    `  routes    home ${counts.home || 0} · list ${counts['posts-list'] || 0} · post ${counts.post || 0} · page ${counts.page || 0} · tags-index ${counts['tags-index'] || 0} · tag ${counts.tag || 0} · 404 ${counts['404'] || 0}`,
    `  assets    css=${assets.css} js=${assets.js}`,
    `  emitted   html ${rendered.length} (${fmtBytes(htmlBytes)}) · xml ${fmtBytes(xmlBytes)} · json ${fmtBytes(jsonBytes)} · media ${mediaCount} · static ${staticCount}`,
    `  output    ${DIST_DIR}`,
  ];
  if (skipped.length) lines.push(`  ignored   ${skipped.join(', ')}`);
  if (assets.notes.length) {
    for (const note of assets.notes) lines.push(`  warn      ${note}`);
  }
  console.log(lines.join('\n'));

  return { pages: routes.length, ms };
}

main().catch((err) => {
  console.error('构建失败：' + (err && err.message ? err.message : String(err)));
  if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  process.exitCode = 1;
});
