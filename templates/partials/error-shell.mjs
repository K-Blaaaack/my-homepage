/** 移植自 layouts/404.html 与 layouts/_default/list.html 的 .box 外壳（error.css） */
import { esc } from '../../build/html.mjs';

const arrow =
  '<svg viewBox="0 0 7 15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

export function errorShell({ lang, title, bodyClass, tag, code, heading, text, content, dataPage }) {
  return `<!DOCTYPE html>
<html lang="${esc(lang)}" data-page="${esc(dataPage)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/css/error.css">
</head>
<body>
<div class="box">
  <div class="tag">${esc(tag)}</div>
${code ? `  <div class="code">${esc(code)}</div>\n` : ''}  <h1>${esc(heading)}</h1>
${text ? `  <p>${esc(text)}</p>\n` : ''}${content || ''}  <a href="/" class="btn">返回首页 ${arrow}</a>
</div>
</body>
</html>
`;
}
