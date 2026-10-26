/**
 * 移植自 layouts/_default/baseof.html
 * 变化（契约 §3.5 / 任务书 §7）：
 *   - <html class="no-js" data-page> + no-js→js 内联切换
 *   - canonical / OG / twitter / JSON-LD、preload meta.json
 *   - skip link、<header> / <main id="main"> / <footer> 地标
 *   - viewport 去掉 maximum-scale / user-scalable=no
 *   - <noscript> 兜底：无 JS 时 loader 隐藏、正文可见
 */
import { esc } from '../../build/html.mjs';
import { CONTENT_BASE, CONTENT_FALLBACK } from '../../build/config.mjs';
import { headMeta } from '../partials/head/meta.mjs';
import { cssLink } from '../partials/head/css.mjs';
import { jsScripts, modulePreloads } from '../partials/head/js.mjs';
import { loaderCooldown } from '../partials/head/loader.mjs';
import { svgDefs } from '../partials/svg-defs.mjs';
import { loaderPartial } from '../partials/loader.mjs';
import { navPartial, mobPartial } from '../partials/nav.mjs';
import { footerPartial } from '../partials/footer.mjs';

const ICONS = `<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`;

/** skip link 的最小样式（stylist 可迁入 components.css 后删除此内联块） */
const SKIP_STYLE =
  '<style>.skip{position:absolute;left:-9999px;top:0;padding:8px 12px;background:var(--ink-2);border:1px solid var(--line-h);color:var(--signal)}.skip:focus{left:8px;top:8px}</style>';

// watchdog（lead 三层保险第 2 层）：入口模块 4s 内没挂上 window.__kb（404 / 被拦 / 抛错）就退回 no-js，
// 由 CSS .no-js .main-wrap{opacity:1} 放行正文。注：不写内联注释，省首页 HTML 字节。
const NO_JS = `<script>document.documentElement.classList.remove("no-js");document.documentElement.classList.add("js");</script>
<script>setTimeout(function(){if(!window.__kb){document.documentElement.classList.remove("js");document.documentElement.classList.add("no-js")}},4000);</script>
<noscript><style>.loader{display:none!important}.main-wrap{opacity:1!important}</style></noscript>`;

export function documentShell({ site, page, assets, year, main, metaCount }) {
  const isHome = page.dataPage === 'home';
  return `<!DOCTYPE html>
<html lang="${esc(site.lang)}" class="no-js" data-page="${esc(page.dataPage)}" data-content-base="${esc(CONTENT_BASE)}" data-content-fallback="${esc(CONTENT_FALLBACK)}">
<head>
<meta charset="UTF-8">
<meta name="kb:meta-count" content="${Number(metaCount) || 0}">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${esc(page.themeColor || '#080a0b')}">
<meta name="color-scheme" content="dark">
${headMeta({ site, page })}
${ICONS}
<link rel="preload" as="fetch" href="/meta.json" crossorigin>
${modulePreloads({ assets })}
${cssLink({ assets })}
${SKIP_STYLE}
${loaderCooldown()}
${NO_JS}
</head>
<body>
<a class="skip" href="#main">跳到主内容</a>
${isHome ? loaderPartial() + '\n' : ''}${svgDefs()}
<div class="main-wrap"${isHome ? ' id="mainWrap"' : ' style="opacity:1"'}>
${navPartial({ site, activeKey: page.activeKey || '' })}
${mobPartial({ site, activeKey: page.activeKey || '' })}
<main id="main">
${main}
</main>
${footerPartial({ site, year })}
</div>
${jsScripts({ site, assets })}
</body>
</html>
`;
}
