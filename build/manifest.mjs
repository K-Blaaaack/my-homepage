/** build/manifest.mjs — meta.json（契约 §3.3，运行时唯一数据契约） */

import { absUrl, encodePath, isoShanghai, nowIso } from './config.mjs';

export function buildManifest({ site, posts, pages, tags }) {
  return {
    version: 1,
    generated_at: nowIso(),
    site: { title: site.title, base: site.base, description: site.description },
    counts: { articles: posts.length, tags: tags.length, pages: pages.length },
    articles: posts.map((post) => ({
      slug: post.slug,
      title: post.title,
      date: isoShanghai(post.date),
      updated: post.updated ? isoShanghai(post.updated) : null,
      tags: post.tags,
      categories: post.categories,
      summary: post.summaryText,
      url: post.url,
      reading_minutes: post.readingMinutes,
      words: post.words,
      cover: post.coverUrl || null,
    })),
    pages: pages.map((page) => ({ slug: page.slug, title: page.title, url: page.url })),
    tags: tags.map((tag) => ({ name: tag.name, slug: tag.slug, count: tag.count, url: tag.url })),
  };
}

export function manifestSiteUrl(site, p) {
  return absUrl(site, encodePath(p));
}
