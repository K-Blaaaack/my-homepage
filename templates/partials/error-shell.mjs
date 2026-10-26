/** 移植自 layouts/404.html 与 layouts/_default/list.html 的 .box 外壳（error.css） */
import { esc } from '../../build/html.mjs';
import { CONTENT_BASE, CONTENT_FALLBACK } from '../../build/config.mjs';
import { cssLink } from './head/css.mjs';
import { entryScript } from './head/js.mjs';

const arrow =
  '<svg viewBox="0 0 7 15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

/**
 * @param {object} o
 * @param {object} o.assets          指纹资产（css/js），error 页也要挂入口模块
 * @param {boolean} [o.withMainCss]  额外加载 main.css（404 需要 .post-content 正文样式；tag 页只留 error.css）
 * @param {boolean} [o.mainWrap]     是否包 .main-wrap + <main id="main">（404 用，与其它页一致）
 * @param {boolean} [o.remoteArticle] 是否输出运行时文章挂载点 <div id="remoteArticle" hidden>
 * @param {number}  [o.metaCount]    构建期文章数（<meta name="kb:meta-count">）
 * @param {string}  [o.extra]        追加在 .box 之后的 HTML（列表容器 / template）
 */
export function errorShell({
  lang,
  title,
  bodyClass,
  tag,
  code,
  heading,
  text,
  content,
  extra,
  dataPage,
  metaCount,
  assets,
  withMainCss = false,
  mainWrap = false,
  remoteArticle = false,
}) {
  const box = `<div class="box">
  <div class="tag">${esc(tag)}</div>
${code ? `  <div class="code">${esc(code)}</div>\n` : ''}  <h1>${esc(heading)}</h1>
${text ? `  <p>${esc(text)}</p>\n` : ''}${content || ''}  <a href="/" class="btn">返回首页 ${arrow}</a>
</div>`;

  const inner = `${box}
${remoteArticle ? '<div id="remoteArticle" hidden></div>\n' : ''}${extra || ''}`;

  const body = mainWrap
    ? `<div class="main-wrap" style="opacity:1">
<main id="main" data-page="${esc(dataPage)}">
${inner}</main>
</div>`
    : inner;

  return `<!DOCTYPE html>
<html lang="${esc(lang)}" class="no-js" data-page="${esc(dataPage)}" data-content-base="${esc(CONTENT_BASE)}" data-content-fallback="${esc(CONTENT_FALLBACK)}">
<head>
<meta charset="UTF-8">
<meta name="kb:meta-count" content="${Number(metaCount) || 0}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<link rel="preload" as="fetch" href="/meta.json" crossorigin>
${withMainCss && assets ? cssLink({ assets }) + '\n' : ''}<link rel="stylesheet" href="/css/error.css">
<script>document.documentElement.classList.remove("no-js");document.documentElement.classList.add("js");</script>
<noscript><style>.main-wrap{opacity:1!important}</style></noscript>
</head>
<body>
${body}
${assets ? entryScript({ assets }) : ''}
</body>
</html>
`;
}
