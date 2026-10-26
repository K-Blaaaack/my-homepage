/** 移植自 layouts/404.html */
import { esc } from '../build/html.mjs';
import { errorShell } from './partials/error-shell.mjs';

export function notFoundPage({ lang, siteTitle }) {
  return errorShell({
    lang,
    title: `404 - ${siteTitle}`,
    dataPage: '404',
    tag: 'ERROR',
    code: '404',
    heading: '页面不存在',
    text: '该页面可能已被移除或地址有误。',
  });
}
