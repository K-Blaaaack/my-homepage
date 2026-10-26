/** 移植自 layouts/partials/footer.html */
import { esc } from '../../build/html.mjs';

export function footerPartial({ site, year }) {
  const copy = site.footer && site.footer.copy ? site.footer.copy : `${site.title}. All rights reserved.`;
  return `<footer class="foot">
  <img class="foot-logo" src="/img/logo-wide.svg" alt="K-Black 的小破站 · Little Website" width="2048" height="617">
  <div class="foot-copy">&copy; ${year} ${esc(copy)}</div>
  <div class="foot-links">
    <a href="${esc(site.github)}" target="_blank">GitHub</a>
    <a href="mailto:${esc(site.email)}">Email</a>
    <a href="${esc(site.base)}" target="_blank">Site</a>
  </div>
</footer>`;
}
