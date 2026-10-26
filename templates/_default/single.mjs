/** 移植自 layouts/_default/single.html（info / wip / 测试 等独立页） */
import { esc } from '../../build/html.mjs';

const arrow =
  '<svg viewBox="0 0 7 15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

export function pageMain({ page, html }) {
  return `<div class="sec" style="min-height:calc(100vh - 56px);display:flex;align-items:center;justify-content:center">
  <article class="page-box">
    <div class="tag">${esc(page.tag || 'PAGE')}</div>
    <h1>${esc(page.title)}</h1>
    <div class="page-content">${html}</div>
    <a href="/" class="btn">返回首页 ${arrow}</a>
  </article>
</div>`;
}
