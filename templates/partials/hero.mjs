/** 移植自 layouts/partials/hero.html（文案来自 data/home.toml [hero]） */
import { esc } from '../../build/html.mjs';

export function heroPartial({ hero }) {
  return `<section class="hero" id="news">
  <div class="hero-bg"></div>
  <div class="hero-particles" id="particles"></div>
  <div class="hero-orbs">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
  </div>
  <div class="hero-scanlines"></div>
  <div class="hero-content">
    <div class="hero-prefix">${esc(hero.prefix)}</div>
    <h1 class="hero-title">${esc(hero.title)}</h1>
    <div class="hero-date" id="heroDate"></div>
    <a href="#profile" class="hero-cta">
      ${esc(hero.cta)} <svg viewBox="0 0 7 15"><use href="#i-arrow"/></svg>
    </a>
  </div>
  <div class="hero-scroll"><span>${esc(hero.scroll)}</span><i></i></div>
</section>`;
}
