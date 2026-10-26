/** 移植自 layouts/partials/profile.html（文案来自 data/home.toml [profile]） */
import { esc } from '../../build/html.mjs';

const tagSpans = (tags) => tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');

export function profilePartial({ profile }) {
  const p = profile || {};
  const intro = (p.intro || []).map((line) => `      <p>${esc(line)}</p>`).join('\n');
  return `<div class="sec" id="profile">
  <div class="sec-hd rv"><div class="sec-tag">${esc(p.label || 'PROFILE 档案')}</div><div class="sec-line"></div></div>
  <div class="prof-grid">
    <div class="prof-card wide rv">
      <div class="prof-label">${esc(p.intro_label || 'INTRODUCTION')}</div>
      <h2>${esc(p.intro_title || '关于我')}</h2>
${intro}
    </div>
    <div class="prof-card rv rv-d1">
      <div class="prof-label">${esc(p.stack_label || 'STACK 技术栈')}</div>
      <h3>${esc(p.stack_title || '技术栈')}</h3>
      <div class="tags">
        ${tagSpans(p.stack_tags || [])}
      </div>
      <a href="/stack/" class="prof-more">${esc(p.stack_more || '查看全部')} <svg viewBox="0 0 7 15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></a>
    </div>
    <div class="prof-card rv rv-d2">
      <div class="prof-label">${esc(p.interests_label || 'INTERESTS 兴趣')}</div>
      <h3>${esc(p.interests_title || '兴趣')}</h3>
      <div class="tags">
        ${tagSpans(p.interests_tags || [])}
      </div>
    </div>
    <div class="prof-card rv rv-d3">
      <div class="prof-label">${esc(p.status_label || 'STATUS 状态')}</div>
      <h3>${esc(p.status_title || '运行状态')}</h3>
      <p id="runtime">${esc(p.status_pending || '计算中...')}</p>
      <p id="lastUpdate" class="about-sm">${esc(p.status_pending || '计算中...')}</p>
    </div>
  </div>
</div>`;
}
