/** build/markdown.mjs — markdown-it 渲染：goldmark 兼容标题锚点 + 相对资源重写 + 代码高亮 */

import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import hljs from 'highlight.js';
import { esc, stripTags } from './html.mjs';

/**
 * goldmark 标题 id 算法（与线上 URL 一致）：
 * 小写、空格转 -、丢弃标点、保留字母/数字/中文/-/_
 * 例：`1. 写回配置不能丢注释` → `1-写回配置不能丢注释`
 */
export function goldmarkSlugify(text) {
  let out = '';
  for (const ch of String(text).trim()) {
    if (ch === ' ' || ch === '\t' || ch === '\n') { out += '-'; continue; }
    if (ch === '-' || ch === '_') { out += ch; continue; }
    if (/[\p{L}\p{N}]/u.test(ch)) { out += ch.toLowerCase(); continue; }
  }
  return out;
}

/**
 * highlight.js → chroma 类名映射。
 * 目的：复用 assets/css/main.css:442-478 既有的 dracula 令牌配色，
 * 不引入新的 .hljs-* 主题文件，保证「视觉零改动」。
 * 双类名并存（hljs-* + chroma），后续若要切原生 hljs 主题只需去掉映射。
 */
const HLJS_TO_CHROMA = {
  keyword: 'k',
  built_in: 'nb',
  type: 'kt',
  literal: 'kc',
  number: 'm',
  operator: 'o',
  punctuation: 'p',
  property: 'nx',
  regexp: 'sr',
  string: 's2',
  'char.escape': 'se',
  subst: 'nx',
  symbol: 'no',
  class: 'nc',
  function: 'nf',
  variable: 'nv',
  'variable.language': 'nv',
  'variable.constant': 'nv',
  title: 'nf',
  'title.class': 'nc',
  'title.class.inherited': 'nc',
  'title.function': 'nf',
  'title.function.invoke': 'nf',
  params: 'nx',
  comment: 'c1',
  doctag: 'cs',
  meta: 'cm',
  'meta.prompt': 'gp',
  'meta keyword': 'k',
  'meta string': 's',
  section: 'nf',
  tag: 'nt',
  name: 'nt',
  attr: 'na',
  attribute: 'na',
  bullet: 'p',
  code: 's',
  emphasis: 'ge',
  strong: 'gs',
  formula: 'gs',
  link: 's',
  quote: 's',
  'selector-tag': 'nt',
  'selector-id': 'na',
  'selector-class': 'na',
  'selector-attr': 'na',
  'selector-pseudo': 'na',
  'template-tag': 'nt',
  'template-variable': 'nv',
  addition: 'gi',
  deletion: 'gd',
};

function mapClasses(htmlText) {
  return htmlText.replace(/class="([^"]*)"/g, (whole, classes) => {
    const out = [];
    for (const token of classes.split(/\s+/).filter(Boolean)) {
      if (!out.includes(token)) out.push(token);
      if (token.startsWith('hljs-')) {
        const mapped = HLJS_TO_CHROMA[token.slice(5)];
        if (mapped && !out.includes(mapped)) out.push(mapped);
      }
    }
    return `class="${out.join(' ')}"`;
  });
}

export const FENCE_LANGS = new Set();

function highlightFence(md) {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0];
    const code = token.content;
    if (info && hljs.getLanguage(info)) {
      FENCE_LANGS.add(info);
      let value;
      try {
        value = hljs.highlight(code, { language: info, ignoreIllegals: true }).value;
      } catch (err) {
        throw new Error(`代码高亮失败（lang=${info}）: ${err.message}`);
      }
      return (
        '<div class="highlight"><pre tabindex="0" class="chroma">' +
        `<code class="language-${esc(info)}" data-lang="${esc(info)}">` +
        mapClasses(value) +
        '</code></pre></div>'
      );
    }
    return `<pre tabindex="0"><code>${esc(code)}</code></pre>`;
  };
}

/**
 * @param {object} opts
 * @param {(src: string, kind: 'image'|'link') => string} opts.resolveAsset
 *        把相对路径重写为 /media/... 绝对路径；无法解析时抛错（构建失败）。
 */
export function createMarkdown({ resolveAsset }) {
  const md = new MarkdownIt({
    html: true,
    linkify: false,
    typographer: false,
    breaks: false,
  });

  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: goldmarkSlugify,
    uniqueSlugStartIndex: 1,
    tabIndex: false,
    permalink: false,
  });

  md.core.ruler.push('kb_rewrite_assets', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      for (const child of token.children) {
        if (child.type === 'image') {
          const src = child.attrGet('src');
          if (src) child.attrSet('src', resolveAsset(src, 'image'));
        } else if (child.type === 'link_open') {
          const href = child.attrGet('href');
          if (href) child.attrSet('href', resolveAsset(href, 'link'));
        }
      }
    }
  });

  highlightFence(md);

  return {
    md,
    /** @returns {{html: string, text: string}} */
    render(body, where = '') {
      let html;
      try {
        // env 必须传对象：markdown-it-anchor 会把去重状态挂在 env.markdownItAnchor 上
        html = md.render(body || '', {});
      } catch (err) {
        throw new Error(`${where}: Markdown 渲染失败 — ${err.message}`);
      }
      return { html, text: stripTags(html) };
    },
  };
}
