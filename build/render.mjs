/** build/render.mjs — 把路由 + 内容渲染成 HTML */

import path from 'node:path';
import { absUrl, encodePath, isoShanghai } from './config.mjs';
import { clip, countWords } from './html.mjs';
import { createMarkdown } from './markdown.mjs';
import { documentShell } from '../templates/_default/baseof.mjs';
import { homeMain } from '../templates/index.mjs';
import { postsListMain } from '../templates/posts/list.mjs';
import { postMain } from '../templates/posts/single.mjs';
import { pageMain } from '../templates/_default/single.mjs';
import { stackMain } from '../templates/stack/single.mjs';
import { taxonomyPage } from '../templates/_default/list.mjs';
import { notFoundPage } from '../templates/404.mjs';

const READING_WPM = 400;

/** 相对路径 → /media/<slug>/<name>.<hash8>.<ext>；解析不到直接抛错（禁止静默跳过） */
function makeAssetResolver(post, mediaIndex) {
  return (src, kind) => {
    const value = String(src || '').trim();
    if (!value) return value;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value; // http:, https:, mailto:, data:
    if (value.startsWith('//') || value.startsWith('#') || value.startsWith('/')) return value;

    const [beforeHash, hash] = value.split('#');
    const clean = beforeHash.split('?')[0];
    const abs = path.resolve(post.dir, decodeURIComponent(clean));
    const hit = mediaIndex.get(abs);
    if (!hit) {
      throw new Error(`${post.rel}: 相对${kind === 'image' ? '图片' : '链接'}指向不存在的文件: ${value}`);
    }
    return hit.url + (hash ? '#' + hash : '');
  };
}

function autoSummary(text) {
  return clip(text, 120);
}

function jsonLdFor({ site, route, page }) {
  const url = absUrl(site, encodePath(page.url));
  if (route.kind === 'home') {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.title,
      url,
      description: page.description,
      inLanguage: site.lang,
      publisher: { '@type': 'Person', name: site.author, url: site.github },
    };
  }
  if (route.kind === 'post') {
    const post = route.post;
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: page.description,
      datePublished: isoShanghai(post.date),
      dateModified: isoShanghai(post.updated || post.date),
      url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: site.lang,
      keywords: post.tags.join(','),
      author: { '@type': 'Person', name: site.author, url: site.github },
      publisher: { '@type': 'Person', name: site.author, url: site.github },
      image: site.base + 'icon-512.png',
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    url,
    description: page.description,
    inLanguage: site.lang,
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.site        站点配置
 * @param {object} ctx.data        { home, news, stack, links }
 * @param {Map}    ctx.mediaIndex  媒体索引（绝对源路径 → 输出信息）
 * @param {object} ctx.assets      { css, js }
 * @param {number} ctx.year        构建年份（页脚）
 */
export function createRenderer(ctx) {
  const { site, data, mediaIndex, assets, year } = ctx;

  // 1) 先渲染所有正文（失败即抛，构建非 0 退出）
  for (const post of ctx.posts) {
    const resolveAsset = makeAssetResolver(post, mediaIndex);
    const { render } = createMarkdown({ resolveAsset });
    const rendered = render(post.body, post.rel);
    post.rendered = rendered;
    post.words = countWords(rendered.text);
    post.readingMinutes = Math.max(1, Math.ceil(post.words / READING_WPM));
    post.summaryText = post.summary || autoSummary(rendered.text);
    post.coverUrl = post.cover ? resolveAsset(post.cover, 'image') : null;
  }

  for (const page of ctx.pages) {
    const { render } = createMarkdown({ resolveAsset: makeAssetResolver(page, mediaIndex) });
    page.rendered = render(page.body, page.rel);
    page.summaryText = page.summary || autoSummary(page.rendered.text);
  }

  const pageCtx = (route, fields) => ({
    url: route.url,
    canonical: absUrl(site, encodePath(route.url)),
    dataPage: route.dataPage,
    activeKey: route.activeKey || '',
    ...fields,
  });

  const withShell = (route, fields, main) => {
    const page = pageCtx(route, fields);
    page.jsonLd = jsonLdFor({ site, route, page });
    return documentShell({ site, page, assets, year, main, metaCount: ctx.posts.length });
  };

  return {
    renderRoute(route) {
      switch (route.kind) {
        case 'home': {
          const main = homeMain({ site, home: data.home, news: data.news, posts: ctx.posts });
          return withShell(route, {
            title: site.title,
            description: site.description,
            ogType: 'website',
            themeColor: '#080a0b',
          }, main);
        }

        case 'posts-list': {
          const main = postsListMain({ posts: ctx.posts });
          return withShell(route, {
            title: `Posts - ${site.title}`,
            description: site.description,
            ogType: 'website',
            themeColor: '#080a0b',
          }, main);
        }

        case 'post': {
          const post = route.post;
          const main = postMain({ post, html: post.rendered.html });
          return withShell(route, {
            title: `${post.title} - ${site.title}`,
            description: post.summaryText,
            ogType: 'article',
            themeColor: '#080a0b',
          }, main);
        }

        case 'page': {
          const page = route.page;
          const main =
            page.slug === 'stack' || page.type === 'stack'
              ? stackMain({ page, html: page.rendered.html, stack: data.stack })
              : pageMain({ page, html: page.rendered.html });
          return withShell(route, {
            title: `${page.title} - ${site.title}`,
            description: page.summaryText || site.description,
            ogType: 'website',
            themeColor: '#080a0b',
          }, main);
        }

        case 'tags-index':
          return taxonomyPage({
            lang: site.lang,
            title: `Tags - ${site.title}`,
            heading: 'Tags',
            dataPage: 'list',
            metaCount: ctx.posts.length,
            assets,
          });

        case 'tag':
          return taxonomyPage({
            lang: site.lang,
            title: `${route.tag.name} - ${site.title}`,
            heading: route.tag.name,
            dataPage: 'list',
            tagSlug: route.tag.slug,
            metaCount: ctx.posts.length,
            assets,
          });

        case '404':
          return notFoundPage({
            lang: site.lang,
            siteTitle: site.title,
            metaCount: ctx.posts.length,
            assets,
          });

        default:
          throw new Error(`未知路由类型: ${route.kind}`);
      }
    },
  };
}
