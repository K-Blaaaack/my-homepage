/** 移植自 layouts/partials/nav.html（导航链接从「写两遍」收敛为一份数据） */
import { esc } from '../../build/html.mjs';

function links(site, activeKey) {
  return site.nav
    .map((item) => {
      const cls = item.key === activeKey ? 'on' : '';
      return `      <a href="${esc(item.href)}" class="${cls}">${esc(item.label)}</a>`;
    })
    .join('\n');
}

export function navPartial({ site, activeKey = '' }) {
  return `<header class="nav">
  <div class="nav-in">
    <div class="nav-brand">
      <img class="nav-brand-logo" src="/img/logo-square.svg" alt="K-Black 的小破站" width="27" height="30">
      <span class="nav-brand-en">K-BLACK</span>
      <span class="nav-brand-sub">K-BLACK.TOP</span>
    </div>
    <nav class="nav-links">
${links(site, activeKey)}
    </nav>
    <button class="burger" id="burger" type="button" aria-label="打开导航菜单" aria-expanded="false" aria-controls="mob"><i></i><i></i><i></i></button>
  </div>
</header>`;
}

export function mobPartial({ site, activeKey = '' }) {
  return `<div class="mob" id="mob">
${links(site, activeKey)}
</div>`;
}
