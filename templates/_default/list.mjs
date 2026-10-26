/**
 * 移植自 layouts/_default/list.html —— /tags/ 与 /tags/<slug>/ 的现状外壳。
 * 现状这两个页面是 0 链接空壳（30 号文档 §1.1 已记录），S5 才补真实列表；
 * 本阶段保持 1:1，避免 URL/文本 parity 被改动。
 */
import { esc } from '../../build/html.mjs';
import { errorShell } from '../partials/error-shell.mjs';

export function taxonomyPage({ lang, title, heading, dataPage = 'list' }) {
  return errorShell({
    lang,
    title,
    dataPage,
    tag: 'TAXONOMY',
    heading: heading || title,
    content: '',
  });
}
