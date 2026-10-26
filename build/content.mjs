/** build/content.mjs — 读取内容仓库：文章、独立页、标签、媒体清单 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

/** front matter 里的 date 可能是 Date（YAML 解析）或字符串 */
function toDate(value, file) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error(`${file}: date 缺失或无法解析`);
}

/** tag → slug：小写、空格转 -、保留中文，与现状 /tags/<slug>/ 一致 */
export function tagSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

/** 统一 tag / tags 两种写法（契约 §2.1） */
function normalizeList(value) {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => String(v).trim()).filter((v) => v !== '');
}

function normalizeFrontMatter(data, file, { requireDate }) {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) throw new Error(`${file}: front matter 缺少 title`);
  // 文章必须带 date（契约 §2.1）；独立页允许缺省（旧 content/ 里 info/wip/测试 就没有）
  const hasDate = data.date !== undefined && data.date !== null && data.date !== '';
  if (!hasDate && requireDate) throw new Error(`${file}: front matter 缺少 date`);
  const date = hasDate ? toDate(data.date, file) : null;
  const updated = data.updated === undefined || data.updated === null ? null : toDate(data.updated, file);
  const tags = normalizeList(data.tags ?? data.tag);
  const categories = normalizeList(data.categories ?? data.category);
  return {
    title,
    date,
    updated,
    draft: data.draft === true,
    tags,
    categories,
    summary: typeof data.summary === 'string' ? data.summary.trim() : '',
    cover: typeof data.cover === 'string' && data.cover.trim() !== '' ? data.cover.trim() : null,
    // 页面角标：兼容旧 tag: "ABOUT" 与契约 tags: ["ABOUT"] 两种写法
    tag:
      typeof data.tag === 'string' && data.tag.trim() !== ''
        ? data.tag.trim()
        : normalizeList(data.tags ?? data.tag)[0] || '',
    type: typeof data.type === 'string' ? data.type.trim() : '',
  };
}

/**
 * 读取内容目录。
 * 兼容两种布局：
 *   A（契约 §2）  content/posts/<slug>/index.md + content/pages/*.md
 *   B（现状仓库） content/posts/<slug>/index.md + content/*.md
 */
export function loadContent(contentDir) {
  if (!fs.existsSync(contentDir)) throw new Error(`内容目录不存在: ${contentDir}`);

  const allMd = fg.sync(['**/*.md'], { cwd: contentDir, absolute: true, dot: false });
  if (!allMd.length) throw new Error(`内容目录里没有 .md: ${contentDir}`);

  const pagesDir = path.join(contentDir, 'pages');
  const hasPagesDir = fs.existsSync(pagesDir);

  const posts = [];
  const pages = [];
  const seenSlug = new Set();

  const skipped = [];

  for (const abs of allMd.sort()) {
    const rel = path.relative(contentDir, abs).split(path.sep).join('/');

    // 非内容文件：README、_meta/、.github/ 等（不作为文章，也不算坏文章）
    const isNoise =
      rel.toLowerCase() === 'readme.md' || rel.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.'));
    if (isNoise) {
      skipped.push(rel);
      continue;
    }

    const isPost = rel.startsWith('posts/');
    const isPage = hasPagesDir ? rel.startsWith('pages/') : !isPost;
    if (!isPost && !isPage) {
      skipped.push(rel);
      continue;
    }

    // 正文哈希：对 md 原始字节做 sha256 取前 16 位十六进制。
    // 不 trim、不做换行归一化 —— 必须与内容仓库 gen-meta.mjs 逐字节一致。
    const bytes = fs.readFileSync(abs);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const raw = bytes.toString('utf8');
    let parsed;
    try {
      parsed = matter(raw);
    } catch (err) {
      throw new Error(`${rel}: front matter 解析失败 — ${err.message}`);
    }
    const fm = normalizeFrontMatter(parsed.data, rel, { requireDate: isPost });

    if (isPost) {
      const dir = path.dirname(abs);
      const isBundle = path.basename(abs) === 'index.md';
      const slug = isBundle ? path.basename(dir) : path.basename(abs, '.md');
      if (seenSlug.has('p/' + slug)) throw new Error(`${rel}: 文章 slug 重复: ${slug}`);
      seenSlug.add('p/' + slug);
      if (fm.draft) continue;
      posts.push({
        kind: 'post',
        slug,
        file: abs,
        rel,
        dir: isBundle ? dir : path.dirname(abs),
        bundle: isBundle,
        url: `/posts/${slug}/`,
        out: `posts/${slug}/index.html`,
        hash,
        ...fm,
        body: parsed.content,
      });
      continue;
    }

    if (isPage) {
      const dir = path.dirname(abs);
      const isBundle = path.basename(abs) === 'index.md';
      const slug = isBundle ? path.basename(dir) : path.basename(abs, '.md');
      if (seenSlug.has('g/' + slug)) throw new Error(`${rel}: 页面 slug 重复: ${slug}`);
      seenSlug.add('g/' + slug);
      if (fm.draft) continue;
      pages.push({
        kind: 'page',
        slug,
        file: abs,
        rel,
        dir: isBundle ? dir : path.dirname(abs),
        bundle: isBundle,
        url: `/${slug}/`,
        out: `${slug}/index.html`,
        ...fm,
        body: parsed.content,
      });
      continue;
    }

    throw new Error(`${rel}: 无法归类的 markdown（既不在 posts/ 也不在 pages/）`);
  }

  if (!posts.length) throw new Error('没有可发布的文章（全部 draft？）');

  // 文章排序：date 倒序，同日期按标题升序（与 Hugo 默认一致）
  posts.sort((a, b) => {
    const dt = b.date.getTime() - a.date.getTime();
    if (dt !== 0) return dt;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });

  // 独立页排序：stack 在前，其余按 slug（仅影响 meta.json.pages 顺序）
  pages.sort((a, b) => {
    if (a.slug === 'stack') return -1;
    if (b.slug === 'stack') return 1;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  // 标签聚合
  const tagMap = new Map();
  for (const post of posts) {
    for (const name of post.tags) {
      const slug = tagSlug(name);
      if (!slug) throw new Error(`${post.rel}: 标签无法生成 slug: ${name}`);
      let entry = tagMap.get(slug);
      if (!entry) {
        entry = { name, slug, count: 0, url: `/tags/${slug}/`, posts: [] };
        tagMap.set(slug, entry);
      }
      entry.count += 1;
      entry.posts.push(post);
    }
  }
  const tags = [...tagMap.values()].sort((a, b) => (b.count - a.count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { posts, pages, tags, skipped };
}
