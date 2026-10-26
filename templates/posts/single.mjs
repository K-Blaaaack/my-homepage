/** 移植自 layouts/posts/single.html */
import { esc } from '../../build/html.mjs';
import { isoDay } from '../../build/config.mjs';

export function postMain({ post, html }) {
  const tags = post.tags.map((t) => `      <span class="tag">${esc(t)}</span>`).join('\n');
  return `<div class="sec" style="min-height:calc(100vh - 56px);padding-top:80px">
  <div class="post-header">
    <a href="/posts/" class="btn" style="margin-bottom:24px;display:inline-flex">← 返回文章列表</a>
    <h1 style="font-size:28px;font-weight:400;margin-bottom:12px">${esc(post.title)}</h1>
    <div class="news-date" style="margin-bottom:8px">${isoDay(post.date)}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px">
${tags}
    </div>
  </div>
  <article class="post-content" data-slug="${esc(post.slug)}">
${html}
  </article>
</div>`;
}
