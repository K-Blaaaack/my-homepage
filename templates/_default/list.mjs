/**
 * 移植自 layouts/_default/list.html —— /tags/ 与 /tags/<slug>/ 的现状外壳。
 * 现状这两个页面是 0 链接空壳（30 号文档 §1.1 已记录），S5 才补真实列表；
 * 本阶段保持 1:1，避免 URL/文本 parity 被改动。
 */
import { esc } from '../../build/html.mjs';
import { errorShell } from '../partials/error-shell.mjs';
import { postItemTemplate } from '../partials/remote-tpl.mjs';

export function taxonomyPage({ lang, title, heading, dataPage = 'list', tagSlug, metaCount, assets }) {
  // tag 终页：外壳仍是 0 链接（1:1 现状），列表容器留给运行时按 data-tag 拉取
  const extra = tagSlug
    ? `<div class="posts-list" data-remote-list="tag" data-tag="${esc(tagSlug)}"></div>
${postItemTemplate()}
`
    : '';
  return errorShell({
    lang,
    title,
    dataPage,
    tag: 'TAXONOMY',
    heading: heading || title,
    content: '',
    extra,
    metaCount,
    assets,
    withMainCss: false, // tag 页维持只加载 error.css（现状外观不变）
  });
}
