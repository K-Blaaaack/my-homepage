/** 移植自 layouts/partials/news.html */
import { esc } from '../../build/html.mjs';
import { monthPath, dayPath } from '../../build/config.mjs';
import { postItemTemplate } from './remote-tpl.mjs';

const arrow = '<div class="news-arrow"><svg viewBox="0 0 7 15" width="7" height="15"><use href="#i-arrow"/></svg></div>';

function featuredBlock(featured, defaultLinkText) {
  if (!featured) return '';
  const link = featured.link;
  const linkHtml = link
    ? `    <a href="${esc(link.url)}" class="news-feat-link"${link.external ? ' target="_blank"' : ''}>
      ${esc(link.text || defaultLinkText)} <svg viewBox="0 0 7 15"><use href="#i-arrow"/></svg>
    </a>
`
    : '';
  return `  <div class="news-featured rv">
    <div class="news-feat-tag">${esc(featured.tag)}</div>
    <div class="news-feat-title">${esc(featured.title)}</div>
    <div class="news-feat-date">${esc(featured.date)}</div>
${linkHtml}  </div>
`;
}

export function newsPartial({ home, news, posts }) {
  const copy = home.news || {};
  const limit = Number.isFinite(copy.latest_count) ? copy.latest_count : 5;
  const latest = posts.slice(0, limit);
  const postItems = latest
    .map(
      (post) => `    <a href="${esc(post.url)}" class="news-item rv" data-c="post">
      <div class="news-tag">${esc(copy.post_tag || '文章')}</div>
      <div class="news-body">
        <div class="news-date">${dayPath(post.date)}</div>
        <div class="news-title">${esc(post.title)}</div>
      </div>
      ${arrow}
    </a>
`
    )
    .join('');

  const dataItems = ((news && news.items) || [])
    .map(
      (item) => `    <a href="${esc(item.url)}" class="news-item rv" data-c="${esc(item.category)}"${item.external ? ' target="_blank"' : ''}>
      <div class="news-tag">${esc(item.tag)}</div>
      <div class="news-body">
        <div class="news-date">${esc(item.label)}</div>
        <div class="news-title">${esc(item.title)}</div>
      </div>
      ${arrow}
    </a>
`
    )
    .join('');

  const tabs = ((copy.tabs) || [])
    .map((tab) => `    <button class="tab${tab.on ? ' on' : ''}" type="button" data-t="${esc(tab.key)}">${esc(tab.label)}</button>`)
    .join('\n');

  return `<div class="sec">
  <div class="news-hd">
    <div class="news-hd-left">
      <div class="news-badge">${esc(copy.badge || 'BREAKING NEWS')}</div>
    </div>
  </div>
${featuredBlock(news && news.featured, copy.default_link_text || '更多情报 READ MORE')}
  <div class="tabs">
${tabs}
  </div>

  <div class="news-list" id="newsList">
    <div data-remote-list="home" data-limit="${limit}"></div>
    <noscript>
${postItems}
    </noscript>
${dataItems}
  </div>
${postItemTemplate()}
</div>`;
}
