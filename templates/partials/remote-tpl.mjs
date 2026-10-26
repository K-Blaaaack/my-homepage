/** 运行时实时同步用的列表项模板（隐藏 <template>，静态页内容不变） */
export function postItemTemplate() {
  return `<template id="postItemTpl"><a class="news-item" href="" data-c="post" aria-label="文章条目"><div class="news-tag"></div><div class="news-body"><div class="news-title"></div><div class="news-summary"></div><div class="news-date"></div></div><div class="news-arrow"><svg viewBox="0 0 7 15" width="7" height="15"><polyline points="1,1 6,7.5 1,14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></div></a></template>`;
}
