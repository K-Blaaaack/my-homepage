/** build/feeds.mjs — sitemap.xml / robots.txt / RSS */

import { absUrl, encodePath, isoShanghai, rfc1123Shanghai } from './config.mjs';

const xmlEsc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function latestDate(posts) {
  return posts.reduce((acc, p) => (!acc || p.date > acc ? p.date : acc), null);
}

/** sitemap：除 404 外全部 HTML 页，URL 与线上 80 条一致 */
export function sitemapXml({ site, routes, posts, tags }) {
  const newest = latestDate(posts);
  const tagNewest = new Map(tags.map((t) => [t.slug, latestDate(t.posts)]));

  const entries = routes
    .filter((r) => r.kind !== '404')
    .map((route) => {
      const loc = absUrl(site, encodePath(route.url));
      let lastmod = null;
      if (route.kind === 'post') lastmod = route.post.updated || route.post.date;
      else if (route.kind === 'home' || route.kind === 'posts-list') lastmod = newest;
      else if (route.kind === 'tag') lastmod = tagNewest.get(route.tag.slug) || null;
      else if (route.kind === 'tags-index') lastmod = newest;
      else if (route.kind === 'page') lastmod = route.page.updated || route.page.date || null;
      return lastmod
        ? `<url>\n    <loc>${xmlEsc(loc)}</loc>\n    <lastmod>${isoShanghai(lastmod)}</lastmod>\n  </url>`
        : `<url>\n    <loc>${xmlEsc(loc)}</loc>\n  </url>`;
    });

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
  ${entries.join('')}
</urlset>
`;
}

export function robotsTxt({ site }) {
  return `User-agent: *
Allow: /

Sitemap: ${absUrl(site, '/sitemap.xml')}
`;
}

/**
 * RSS 2.0
 * @param {object} opts
 * @param {string} opts.channelTitle
 * @param {string} opts.channelPath   频道首页路径（/ 或 /posts/）
 * @param {string} opts.selfPath      atom:link self 路径
 * @param {string} opts.description
 */
export function rssXml({ site, posts, channelTitle, channelPath, selfPath, description }) {
  const newest = latestDate(posts);
  const items = posts
    .map((post) => {
      const url = absUrl(site, encodePath(post.url));
      return `    <item>
      <title>${xmlEsc(post.title)}</title>
      <link>${xmlEsc(url)}</link>
      <pubDate>${rfc1123Shanghai(post.date)}</pubDate>
      <guid>${xmlEsc(url)}</guid>
      <description>${xmlEsc(post.summaryText || '')}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEsc(channelTitle)}</title>
    <link>${xmlEsc(absUrl(site, channelPath))}</link>
    <description>${xmlEsc(description)}</description>
    <generator>K-BLACK build v3</generator>
    <language>${xmlEsc(site.lang)}</language>
    <lastBuildDate>${rfc1123Shanghai(newest)}</lastBuildDate>
    <atom:link href="${xmlEsc(absUrl(site, selfPath))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
}
