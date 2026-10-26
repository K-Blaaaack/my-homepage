/** 移植自 layouts/posts/list.html */
import { esc } from '../../build/html.mjs';
import { monthPath } from '../../build/config.mjs';
import { postItemTemplate } from '../partials/remote-tpl.mjs';

export function postsListMain({ posts }) {
  const items = posts
    .map(
      (post) => `    <a href="${esc(post.url)}" class="news-item">
      <div class="news-tag">${monthPath(post.date)}</div>
      <div class="news-body">
        <div class="news-date">${esc(post.categories.join(''))}</div>
        <div class="news-title">${esc(post.title)}</div>
      </div>
      <div class="news-arrow"><svg viewBox="0 0 7 15" width="7" height="15"><use href="#i-arrow"/></svg></div>
    </a>`
    )
    .join('\n');
  return `<div class="sec" style="min-height:calc(100vh - 56px);padding-top:80px">
  <div class="sec-hd"><div class="sec-tag">POSTS 文章</div><div class="sec-line"></div></div>
  <div class="posts-list" data-remote-list="posts">
${items}
  </div>
${postItemTemplate()}
</div>`;
}
