/** 移植自 layouts/index.html（首页 = nav + hero + news + profile + about） */
import { heroPartial } from './partials/hero.mjs';
import { newsPartial } from './partials/news.mjs';
import { profilePartial } from './partials/profile.mjs';
import { aboutPartial } from './partials/about.mjs';

export function homeMain({ site, home, news, posts }) {
  return [
    heroPartial({ hero: home.hero || {} }),
    newsPartial({ home, news, posts }),
    profilePartial({ profile: home.profile }),
    aboutPartial({ about: home.about, site }),
  ].join('\n');
}
