/** 移植自 layouts/404.html */
import { errorShell } from './partials/error-shell.mjs';

export function notFoundPage({ lang, siteTitle, metaCount, assets }) {
  return errorShell({
    lang,
    title: `404 - ${siteTitle}`,
    dataPage: '404',
    tag: 'ERROR',
    code: '404',
    heading: '页面不存在',
    text: '该页面可能已被移除或地址有误。',
    metaCount,
    assets,
    withMainCss: true, // 运行时渲染的新文章需要 .post-content 正文样式
    mainWrap: true,
    remoteArticle: true,
  });
}
