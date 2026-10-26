/** 移植自 layouts/stack/single.html（groups 来自 data/stack.toml） */
import { esc } from '../../build/html.mjs';

const arrow =
  '<svg viewBox="0 0 7 15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

export function stackMain({ page, html, stack }) {
  const groups = ((stack && stack.groups) || [])
    .map(
      (group) => `    <div class="stack-card">
      <div class="prof-label">${esc(group.en)}</div>
      <h3>${esc(group.name)}</h3>
      <div class="tags">
        ${(group.items || []).map((i) => `<span class="tag">${esc(i)}</span>`).join('')}
      </div>
    </div>`
    )
    .join('\n');
  return `<div class="sec" style="min-height:calc(100vh - 56px);padding-top:80px">
  <div class="sec-hd"><div class="sec-tag">STACK 技术栈</div><div class="sec-line"></div></div>
  ${html ? `<div class="stack-lead">${html}</div>` : ''}
  <div class="stack-grid">
${groups}
  </div>
  <div style="margin-top:36px">
    <a href="/" class="btn">返回首页 ${arrow}</a>
  </div>
</div>`;
}
