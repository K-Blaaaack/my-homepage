/** 移植自 layouts/partials/links.html（当前首页未引用，保留 1:1 移植） */
import { esc } from '../../build/html.mjs';

export function linksPartial({ links }) {
  const items = ((links && links.items) || [])
    .map(
      (item) => `    <a href="${esc(item.url)}" class="lnk rv"${item.external ? ' target="_blank"' : ''}>
      <div class="lnk-ico">${esc(item.icon)}</div>
      <div class="lnk-body"><div class="lnk-name">${esc(item.name)}</div><div class="lnk-desc">${esc(item.desc)}</div></div>
      <div class="lnk-arrow"><svg viewBox="0 0 7 15" width="7" height="15"><use href="#i-arrow"/></svg></div>
    </a>`
    )
    .join('\n');
  return `<div class="sec" id="links">
  <div class="sec-hd rv"><div class="sec-tag">LINKS 链接</div><div class="sec-line"></div></div>
  <div class="links-grid">
${items}
  </div>
</div>`;
}
