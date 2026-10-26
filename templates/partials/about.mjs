/** 移植自 layouts/partials/about.html（卡片文案来自 data/home.toml [[about.cards]]） */
import { esc } from '../../build/html.mjs';

export function aboutPartial({ about, site }) {
  const a = about || {};
  const cards = (a.cards || [])
    .map((card, i) => {
      const body = String(card.body || '')
        .replaceAll('{email}', esc(site.email))
        .replaceAll('{github_source}', esc(site.githubSource));
      const delay = i === 0 ? '' : ` rv-d${i}`;
      return `    <div class="about-card rv${delay}">
      <div class="about-label">${esc(card.label)}</div>
      <h3>${esc(card.title)}</h3>
      <p>${body}</p>
    </div>`;
    })
    .join('\n');
  return `<div class="sec" id="about">
  <div class="sec-hd rv"><div class="sec-tag">${esc(a.label || 'ABOUT 关于')}</div><div class="sec-line"></div></div>
  <div class="about-grid">
${cards}
  </div>
</div>`;
}
